import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Booking, { isCodPaymentMethod, IBuyerDetails, pushStatus } from "../models/Booking.model";
import Material from "../models/Material.model";
import User from "../models/User.model";
import Vendor from "../models/Vendor.model";
import VendorMaterial from "../models/VendorMaterial.model";
import Payment from "../models/Payment.model";
import Transaction from "../models/Transaction.model";
import AppSettings from "../models/AppSettings.model";
import { AppError } from "../middlewares/errorHandler";
import { UserRequest } from "../middlewares/userAuth.middleware";
import {
  evaluateOffer,
  findOfferByCode,
  resolveCart,
} from "../services/offerEngine";
import { recordOfferRedemption } from "./mobileOffers.controller";
import { buildTaxInvoiceHtml } from "../utils/taxInvoiceHtml";
import { notifyVendors } from "../services/vendorNotify";
import { notifyAdmin } from "../services/adminNotify";
import { refund as refundRazorpayPayment } from "../services/razorpayService";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export const generateBookingId = async (): Promise<string> => {
  const count = await Booking.countDocuments();
  const timestamp = Date.now().toString().slice(-6);
  return `BK-${count + 1}-${timestamp}`;
};

/**
 * Enforces the mandatory checkout-details requirement server-side — the
 * client's CheckoutDetailsScreen already requires these fields, but a
 * client can't be trusted (same rationale computeCartPricing already
 * documents for pricing), so this is the real gate. Called before any
 * Payment/Booking is created on both the direct and Razorpay checkout paths.
 */
export const validateBuyerDetails = (buyerDetails: unknown): IBuyerDetails => {
  const b = buyerDetails as Partial<IBuyerDetails> | undefined;
  if (!b || typeof b !== "object") {
    throw new AppError("Buyer/checkout details are required.", 400);
  }
  if (b.accountType !== "individual" && b.accountType !== "company") {
    throw new AppError("Buyer account type (individual/company) is required.", 400);
  }

  const requireField = (value: unknown, label: string) => {
    if (!String(value ?? "").trim()) {
      throw new AppError(`${label} is required.`, 400);
    }
  };

  requireField(b.name, "Name");
  requireField(b.mobile, "Mobile number");
  requireField(b.city, "City");
  requireField(b.pincode, "PIN code");

  if (b.accountType === "individual") {
    requireField(b.deliveryAddress, "Delivery address");
  } else {
    requireField(b.companyName, "Company name");
    requireField(b.billingAddress, "Billing address");
    requireField(b.registeredOfficeAddress, "Registered office address");
    requireField(b.companyType, "Company type");
    requireField(b.siteAddress, "Site address");
    requireField(b.siteContactPerson, "Site contact person");
    // `deliveryAddress` is required on the schema shape used for both types —
    // for a company order it's the site address (same physical delivery
    // point), so mirror it across if the client didn't send it explicitly.
    if (!String(b.deliveryAddress ?? "").trim()) {
      b.deliveryAddress = b.siteAddress;
    }
  }

  return b as IBuyerDetails;
};

export interface CheckoutItem {
  materialId: string;
  quantity: number;
  gstAmount?: number;
  // Vendor the customer explicitly chose for this line via the region/
  // pincode comparison screen (Section I / F28-34) — when present, the
  // resulting Booking is bound to this vendor at creation and never
  // auto-reassigned. Omitted lines fall back to admin manually assigning a
  // vendor later (the existing admin Bookings vendor picker) — there is no
  // more vendor claim-race fallback.
  vendorId?: string;
}

export interface CartLine {
  material: any;
  quantity: number;
  price: number;
  gstAmount: number;
  lineDiscount: number;
  convenienceFee: number;
  totalAmount: number;
  vendorId?: string;
}

/**
 * The per-material "Convenience Fee" configured by the admin on the
 * Materials form (Material.transportation). "per_km" has no distance data
 * available anywhere in this codebase yet (no routing/Distance-Matrix call),
 * so it's treated the same as "fixed" rather than silently guessing a
 * distance — real per-km pricing is a future enhancement.
 */
const computeConvenienceFee = (
  transportation: { type?: string; charge?: number } | undefined,
  quantity: number,
): number => {
  const charge = Number(transportation?.charge) || 0;
  if (!transportation || transportation.type === "free" || charge <= 0) return 0;
  if (transportation.type === "per_unit") return +(charge * quantity).toFixed(2);
  return +charge.toFixed(2); // "fixed" and "per_km" (see caveat above)
};

export interface CartPricingResult {
  lines: CartLine[];
  totalDiscount: number;
  offerForRedemption: any;
  deliveryPincode: string;
  grandTotal: number;
}

/**
 * Prices a cart (materials, coupon, per-line GST/discount split) without
 * creating any Booking documents. Shared by the direct-checkout flow
 * (createOrderFromCart) and the Razorpay flow (payments.controller.ts) so
 * both price the exact same cart identically and a client-sent amount is
 * never trusted for the Razorpay order total.
 */
export const computeCartPricing = async (
  userId: string,
  body: {
    items?: CheckoutItem[];
    gstAmounts?: Record<string, number>;
    site?: string;
    pincode?: string;
    couponCode?: string;
  },
): Promise<CartPricingResult> => {
  const { items, site, pincode: bodyPincode, couponCode } = body;

  const gstByMaterialId = new Map<string, number>();
  if (Array.isArray(items)) {
    for (const it of items) {
      const g = Number((it as any)?.gstAmount);
      if (Number.isFinite(g)) gstByMaterialId.set(it.materialId, g);
    }
  }
  const gstAmounts = body?.gstAmounts;
  if (gstAmounts && typeof gstAmounts === "object") {
    for (const [k, v] of Object.entries(gstAmounts)) {
      const g = Number(v);
      if (Number.isFinite(g)) gstByMaterialId.set(k, g);
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError("Cart is empty.", 400);
  }

  const materialIds = items.map((i) => i.materialId);
  const materials = await Material.find({
    _id: { $in: materialIds },
    isDeleted: false,
    status: "active",
  });

  if (materials.length === 0) {
    throw new AppError("None of the cart items are available.", 400);
  }

  const matMap = new Map(materials.map((m) => [m._id.toString(), m]));

  let totalDiscount = 0;
  let offerForRedemption: any = null;
  if (couponCode) {
    const offer = await findOfferByCode(couponCode);
    if (!offer) throw new AppError("Invalid coupon code.", 400);
    const resolved = await resolveCart(items);
    const evalRes = await evaluateOffer(offer, resolved, userId);
    if (!evalRes.valid) {
      throw new AppError(evalRes.reason || "Coupon could not be applied.", 400);
    }
    totalDiscount = evalRes.discountAmount;
    offerForRedemption = offer;
  }

  // Validate any customer-selected vendors (Section I) up front — a vendor
  // chosen on the comparison screen (Phase 6) must still actually stock this
  // material, be approved, and be active by the time checkout happens (it
  // may have changed in the meantime). Reject clearly rather than silently
  // dropping the selection, since "your selected vendor" is a promise made
  // to the customer on the previous screen.
  const requestedVendorIds = Array.from(
    new Set(items.map((it) => (it as any).vendorId).filter(Boolean)),
  ) as string[];
  const validVendorMaterialPairs = new Set<string>();
  if (requestedVendorIds.length > 0) {
    const [activeVendors, stockingEntries] = await Promise.all([
      Vendor.find({
        _id: { $in: requestedVendorIds },
        status: "active",
        approvalStatus: "approved",
        isDeleted: false,
      })
        .select("_id")
        .lean(),
      VendorMaterial.find({
        vendor: { $in: requestedVendorIds },
        material: { $in: materialIds },
        isAvailable: true,
        verificationStatus: "approved",
      })
        .select("vendor material")
        .lean(),
    ]);
    const activeVendorIds = new Set(activeVendors.map((v) => String(v._id)));
    stockingEntries.forEach((s) => {
      if (activeVendorIds.has(String(s.vendor))) {
        validVendorMaterialPairs.add(`${s.vendor}:${s.material}`);
      }
    });
  }

  const rawLines = items
    .map((it) => {
      const m = matMap.get(it.materialId);
      if (!m) return null;
      const quantity = Math.max(m.minOrderQty || 1, Number(it.quantity) || 1);
      const price = m.finalSellingPrice ?? m.sellingPrice ?? 0;
      const requestedVendorId = (it as any).vendorId as string | undefined;
      let vendorId: string | undefined;
      if (requestedVendorId) {
        if (
          !validVendorMaterialPairs.has(`${requestedVendorId}:${m._id}`)
        ) {
          throw new AppError(
            `Your selected vendor for ${m.name} is no longer available. Please choose again.`,
            400,
          );
        }
        vendorId = requestedVendorId;
      }
      return { material: m, quantity, price, gross: price * quantity, vendorId };
    })
    .filter(Boolean) as Array<{
    material: any;
    quantity: number;
    price: number;
    gross: number;
    vendorId?: string;
  }>;
  const grossTotal = rawLines.reduce((s, l) => s + l.gross, 0) || 1;

  const firstPin = (s: unknown): string =>
    (String(s ?? "").match(/\d{6}/) || [])[0] || "";
  const userDoc = await User.findById(userId)
    .select("address.pincode")
    .lean();
  const deliveryPincode =
    firstPin(bodyPincode) ||
    firstPin(site) ||
    firstPin(userDoc?.address?.pincode) ||
    "";

  const lines: CartLine[] = [];
  let discountAllocated = 0;
  let grandTotal = 0;
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const lineDiscount =
      idx === rawLines.length - 1
        ? Math.max(0, totalDiscount - discountAllocated)
        : Math.round(((line.gross / grossTotal) * totalDiscount) * 100) / 100;
    discountAllocated += lineDiscount;

    // GST is derived from the product price only (post-discount, pre-fee) —
    // the convenience fee is a separate delivery-type charge, not part of
    // the GST-inclusive product price.
    const productAmount = Math.max(0, line.gross - lineDiscount);
    const convenienceFee = computeConvenienceFee(
      line.material.transportation,
      line.quantity,
    );
    const totalAmount = productAmount + convenienceFee;

    const sentGst = gstByMaterialId.get(line.material._id.toString());
    let gstAmount = 0;
    if (sentGst !== undefined && Number.isFinite(sentGst) && sentGst > 0) {
      gstAmount = +sentGst.toFixed(2);
    } else {
      const rate = Number(line.material.gst) || 0;
      if (rate > 0) {
        gstAmount = +(productAmount - productAmount / (1 + rate / 100)).toFixed(2);
      }
    }

    lines.push({
      material: line.material,
      quantity: line.quantity,
      price: line.price,
      gstAmount,
      lineDiscount: +lineDiscount.toFixed(2),
      convenienceFee,
      totalAmount,
      vendorId: line.vendorId,
    });
    grandTotal += totalAmount;
  }

  return {
    lines,
    totalDiscount,
    offerForRedemption,
    deliveryPincode,
    grandTotal,
  };
};

/**
 * Creates one Booking per priced cart line, notifies matching vendors, and
 * records offer redemption — the second half of checkout, shared by the
 * direct (COD/manual) flow and the post-payment-verified Razorpay flow.
 */
export const createBookingsFromPricing = async (
  userId: string,
  pricing: CartPricingResult,
  opts: {
    paymentMethod?: string;
    site?: string;
    notes?: string;
    paymentGateway?: "razorpay" | "cod" | "manual";
    razorpayOrderId?: string;
    paymentStatus?: "pending" | "partial" | "completed";
    buyerDetails?: IBuyerDetails;
  },
): Promise<any[]> => {
  const { lines, deliveryPincode, totalDiscount, offerForRedemption } = pricing;
  const created: any[] = [];

  for (const line of lines) {
    const bookingId = await generateBookingId();

    // Section I (Phase 7): a customer-selected vendor is bound at creation
    // and never auto-reassigned or fanned out to other vendors to "claim" —
    // a line with no selection stays unassigned for admin to allocate
    // manually (the existing admin Bookings vendor picker), same as it does
    // today after an admin un-assigns a vendor.
    const booking = await Booking.create({
      bookingId,
      user: userId,
      material: line.material._id,
      vendor: line.vendorId || undefined,
      quantity: line.quantity,
      unit: line.material.unit,
      price: line.price,
      totalAmount: line.totalAmount,
      gstAmount: line.gstAmount,
      discountAmount: line.lineDiscount,
      convenienceFee: line.convenienceFee,
      site: opts.site,
      pincode: deliveryPincode || undefined,
      notes: opts.notes,
      paymentMethod: opts.paymentMethod,
      paymentGateway: opts.paymentGateway,
      razorpayOrderId: opts.razorpayOrderId,
      paymentStatus: opts.paymentStatus,
      buyerDetails: opts.buyerDetails,
      createdBy: userId,
      statusHistory: [{ status: "pending", at: new Date() }],
    });

    const populated = await Booking.findById(booking._id)
      .populate("material", "name images unit")
      .lean();
    created.push(populated);
  }

  if (created.length === 0) {
    throw new AppError("Could not create any orders from the cart.", 400);
  }

  // Notify exactly the vendor(s) the customer actually selected — no more
  // fan-out to every pincode-matching vendor to race for it.
  for (const b of created as any[]) {
    if (!b.vendor) continue;
    await notifyVendors([b.vendor], {
      title: "New order assigned to you",
      message: `Order ${b.bookingId} has been placed with you. Tap to view.`,
      booking: b._id,
      image: b.material?.images?.[0],
      createdBy: userId,
    });
  }

  // Any line left unassigned needs admin to pick a vendor manually.
  const unassignedCount = (created as any[]).filter((b) => !b.vendor).length;
  if (unassignedCount > 0) {
    notifyAdmin({
      title: "Order needs a vendor assigned",
      message: `${unassignedCount} new order${unassignedCount > 1 ? "s" : ""} placed without a vendor selection (pincode ${deliveryPincode || "n/a"}) — please assign a vendor.`,
      booking: (created as any[]).find((b) => !b.vendor)?._id,
      createdBy: userId,
    }).catch(() => {});
  }

  notifyAdmin({
    title: "New order placed",
    message: `${created.length} new order${created.length > 1 ? "s" : ""} placed (pincode ${deliveryPincode || "n/a"}).`,
    booking: created[0]?._id,
    createdBy: userId,
  }).catch(() => {});

  if (offerForRedemption && totalDiscount > 0) {
    await recordOfferRedemption(
      offerForRedemption._id.toString(),
      userId,
      created[0]?._id?.toString() || null,
      totalDiscount,
    );
  }

  return created;
};

/**
 * GET /api/mobile/orders
 * List the current user's bookings, sorted newest first.
 * Optional ?status=ongoing|past filters.
 */
export const listMyOrders = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const status = (req.query.status as string) || "all";

    const query: any = { user: userId, isDeleted: false };

    if (status === "ongoing") {
      query.status = {
        $in: [
          "pending",
          "accepted",
          "confirmed",
          "qc_pending",
          "qc_approved",
          "qc_rejected",
          "packed",
          "dispatched",
          "in_transit",
          // Needs admin resolution, not a final state — still "ongoing" from
          // the customer's point of view (Section I / Phase 7).
          "vendor_rejected",
        ],
      };
    } else if (status === "past") {
      query.status = { $in: ["delivered", "cancelled"] };
    }

    const bookings = await Booking.find(query)
      .populate("material", "name images unit")
      .populate("vendor", "name mobile")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/mobile/orders/:id
 * Get a single booking belonging to the current user.
 */
export const getMyOrder = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    // Accept either the Mongo _id or the human-facing bookingId (e.g. "BK-12-345678")
    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking = await Booking.findOne({
      user: userId,
      isDeleted: false,
      $or: orQuery,
    })
      .populate("material", "name images unit description")
      .populate("vendor", "name mobile email")
      .lean();

    if (!booking) throw new AppError("Order not found.", 404);

    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
};

const CANCELLABLE_STATUSES = ["pending", "accepted", "confirmed"];
const CANCEL_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/mobile/orders/:id/cancel
 * Lets a buyer self-cancel within 15 minutes of placing an order, before QC/
 * packing starts. Per-Booking (not per-cart) — matches every other lifecycle
 * action in this codebase (vendor accept/reject/QC/dispatch), and sidesteps
 * "what if one cart line is already packed" entirely. Auto-refunds via
 * Razorpay if the order was paid online; never blocks cancellation on
 * refund success — a failed refund becomes a visible manual-follow-up note.
 */
export const cancelOrder = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const { reason } = req.body as { reason?: string };

    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking = await Booking.findOne({
      user: userId,
      isDeleted: false,
      $or: orQuery,
    });

    if (!booking) throw new AppError("Order not found.", 404);

    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
      throw new AppError(
        "This order can no longer be cancelled — it's already being processed.",
        400,
      );
    }
    if (Date.now() - booking.createdAt.getTime() > CANCEL_WINDOW_MS) {
      throw new AppError(
        "This order can no longer be cancelled — the 15-minute window has passed.",
        400,
      );
    }

    pushStatus(booking, "cancelled", reason || "Cancelled by customer");

    if (booking.paymentGateway === "razorpay" && booking.paymentStatus === "completed") {
      const payment = booking.razorpayOrderId
        ? await Payment.findOne({ razorpayOrderId: booking.razorpayOrderId })
        : null;

      if (payment?.razorpayPaymentId) {
        const result = await refundRazorpayPayment(
          payment.razorpayPaymentId,
          booking.totalAmount,
          { bookingId: booking.bookingId },
        );

        if (result) {
          await Transaction.create({
            booking: booking._id,
            user: userId,
            amount: booking.totalAmount,
            currency: "INR",
            mode: "other",
            type: "refund",
            status: "settled",
            description: "Razorpay refund on customer cancellation",
            meta: {
              razorpayOrderId: booking.razorpayOrderId,
              razorpayPaymentId: payment.razorpayPaymentId,
              refundId: result.id,
            },
          });
          booking.notes = `${booking.notes ? booking.notes + "\n" : ""}Refunded via Razorpay (refund id: ${result.id}).`;
        } else {
          console.error(
            `[cancelOrder] Refund failed for booking ${booking.bookingId} (payment ${payment.razorpayPaymentId}) — needs manual follow-up.`,
          );
          booking.notes = `${booking.notes ? booking.notes + "\n" : ""}Refund pending — manual follow-up required.`;
        }
      }
    }

    await booking.save({ validateModifiedOnly: true });

    const populated = await Booking.findById(booking._id)
      .populate("material", "name images unit description")
      .lean();

    res.json({
      success: true,
      message: "Order cancelled successfully.",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/mobile/orders
 * Create bookings from a cart payload. One Booking per cart line item.
 * Body: { items: [{ materialId, quantity }], paymentMethod?, site?, notes? }
 */
export const createOrderFromCart = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const { items, paymentMethod, site, notes, couponCode, pincode, gstAmounts, buyerDetails: rawBuyerDetails } =
      req.body as {
        items?: CheckoutItem[];
        paymentMethod?: string;
        site?: string;
        notes?: string;
        couponCode?: string;
        pincode?: string;
        gstAmounts?: Record<string, number>;
        buyerDetails?: unknown;
      };

    const buyerDetails = validateBuyerDetails(rawBuyerDetails);

    const pricing = await computeCartPricing(userId, {
      items,
      gstAmounts,
      site,
      pincode,
      couponCode,
    });

    const paymentGateway = isCodPaymentMethod(paymentMethod) ? "cod" : "manual";

    const created = await createBookingsFromPricing(userId, pricing, {
      paymentMethod,
      site,
      notes,
      paymentGateway,
      buyerDetails,
    });

    // Best-effort — pre-fills the next checkout, never blocks this one.
    User.updateOne({ _id: userId }, { $set: { checkoutProfile: buyerDetails } }).catch(() => {});

    res.status(201).json({
      success: true,
      message: `${created.length} order(s) placed successfully.`,
      data: created,
      discountApplied: pricing.totalDiscount,
    });
  } catch (error) {
    next(error);
  }
};

// Order of lifecycle steps the customer tracking timeline renders. Each step
// maps to one-or-more real booking statuses; once the booking has passed (or is
// at) a step, that step is marked done with the timestamp from statusHistory.
const TRACKING_STEPS: Array<{
  key: string;
  label: string;
  statuses: string[];
}> = [
  { key: "placed", label: "Placed", statuses: ["pending"] },
  {
    key: "accepted",
    label: "Accepted",
    statuses: ["accepted", "confirmed"],
  },
  {
    key: "qc",
    label: "QC",
    statuses: ["qc_pending", "qc_approved"],
  },
  { key: "packed", label: "Packed", statuses: ["packed"] },
  { key: "dispatched", label: "Dispatched", statuses: ["dispatched"] },
  {
    key: "out_for_delivery",
    label: "Out for delivery",
    statuses: ["in_transit"],
  },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
];

// Linear rank of a status within the lifecycle, used to decide which steps are
// already "done". `confirmed` ranks with `accepted`.
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  accepted: 1,
  confirmed: 1,
  qc_pending: 2,
  qc_approved: 2,
  qc_rejected: 2,
  packed: 3,
  dispatched: 4,
  in_transit: 5,
  delivered: 6,
  cancelled: 6,
};

/**
 * GET /api/mobile/orders/:id/tracking
 * Returns a normalized delivery timeline for one of the user's bookings.
 */
export const getOrderTracking = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking: any = await Booking.findOne({
      user: userId,
      isDeleted: false,
      $or: orQuery,
    })
      .populate("driver", "name vehicles.registrationNo")
      .lean();

    if (!booking) throw new AppError("Order not found.", 404);

    const history: Array<{ status: string; at: Date }> =
      booking.statusHistory || [];
    // First timestamp recorded for each status (for the step "at" field).
    const firstAt = new Map<string, Date>();
    for (const h of history) {
      if (!firstAt.has(h.status)) firstAt.set(h.status, h.at);
    }

    const currentRank = STATUS_RANK[booking.status as string] ?? 0;
    const cancelled = booking.status === "cancelled";

    const steps = TRACKING_STEPS.map(step => {
      const stepRank = STATUS_RANK[step.statuses[0]] ?? 0;
      const done = !cancelled && currentRank >= stepRank;
      // Earliest matching timestamp for any of the step's statuses.
      let at: Date | null = null;
      for (const s of step.statuses) {
        const t = firstAt.get(s);
        if (t && (!at || t < at)) at = t;
      }
      // Fall back to createdAt for the "Placed" step on legacy bookings.
      if (!at && step.key === "placed") at = booking.createdAt;
      return { key: step.key, label: step.label, done, at: at || null };
    });

    const driverDoc = booking.driver;
    const driver = driverDoc
      ? {
          name: driverDoc.name || booking.dispatch?.driverName || "Driver",
          vehicleNumber:
            driverDoc.vehicles?.[0]?.registrationNo ||
            booking.dispatch?.vehicleNumber ||
            null,
        }
      : booking.dispatch?.driverName
        ? {
            name: booking.dispatch.driverName,
            vehicleNumber: booking.dispatch.vehicleNumber || null,
          }
        : null;

    res.json({
      success: true,
      data: {
        bookingId: booking.bookingId,
        status: booking.status,
        cancelled,
        steps,
        driver,
        deliveryDate: booking.deliveryDate || null,
        dropAddress: booking.site || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/orders/:id/invoice?token=...
// Returns a printable HTML invoice. Authenticated via the `token` query param
// (so it can be opened directly in the device browser, where the user can use
// "Save as PDF" / Print) or the standard Authorization header. No PDF library
// is needed — the browser handles PDF export.
export const getOrderInvoiceHtml = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const headerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : undefined;
    const token = (req.query.token as string) || headerToken;
    if (!token) throw new AppError("No token provided", 401);

    let userId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id: string;
        type: string;
      };
      if (decoded.type !== "user") throw new AppError("Invalid token", 401);
      userId = decoded.id;
    } catch {
      throw new AppError("Invalid or expired token", 401);
    }

    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking: any = await Booking.findOne({
      user: userId,
      isDeleted: false,
      $or: orQuery,
    })
      .populate("material", "name unit hsn gst")
      .populate("vendor", "name business bankDetails mobile email")
      .populate("user", "name mobile email address")
      .lean();

    if (!booking) throw new AppError("Order not found.", 404);
    if (booking.status !== "delivered") {
      throw new AppError("Invoice is available once the order is delivered.", 400);
    }
    if (booking.paymentStatus !== "completed") {
      throw new AppError("Invoice is available once payment is confirmed.", 400);
    }

    const material = booking.material || {};
    const cust = booking.user || {};

    // Buyer-facing invoice shows OTG (not the vendor) as seller of record —
    // matches invoiceService.ts's ensureInvoicesGenerated, which persists
    // the same "vendor_to_customer" invoice type with OTG as seller. This
    // endpoint renders live/on-demand rather than reading that persisted
    // record, so it needs the same company-profile source independently.
    const settings = await AppSettings.findOne({ key: "default" }).lean();
    const company = settings?.companyProfile || ({} as Record<string, string>);

    const qty = Number(booking.quantity || 0);
    const total = Number(booking.totalAmount || 0);
    const gstAmount = Number(booking.gstAmount || 0);
    const basic = Math.max(total - gstAmount, 0);
    const gstRate = Number(material.gst || 0);
    const cgst = gstAmount / 2;
    const sgst = gstAmount / 2;
    const rate = qty ? basic / qty : basic;
    const issued = new Date(booking.createdAt).toLocaleDateString("en-IN");

    const html = buildTaxInvoiceHtml({
      sellerName: company.name || "OTG",
      sellerAddress: company.address,
      sellerCity: company.city,
      sellerPincode: company.pincode,
      sellerState: company.state,
      sellerGstin: company.gstin,
      sellerPan: company.pan,
      bankAccountNumber: company.bankAccountNumber,
      bankIfsc: company.bankIfsc,
      bankName: company.bankName,
      invoiceNo: booking.bookingId,
      orderNo: booking.bookingId,
      issuedDate: issued,
      paymentMethod: booking.paymentMethod,
      // Sourced from the frozen per-order snapshot (buyerDetails) — never
      // from a live User read, so a later profile edit can't silently
      // rewrite a past invoice. Falls back to the live User for orders
      // placed before this field existed.
      consigneeName: booking.buyerDetails?.name || cust.name || "Customer",
      consigneeAddress:
        booking.buyerDetails?.deliveryAddress || booking.site || cust.address?.full,
      consigneeMobile: booking.buyerDetails?.mobile || cust.mobile,
      dispatchThrough: booking.dispatch?.driverName,
      vehicleNumber: booking.dispatch?.vehicleNumber,
      materialName: material.name || "",
      hsn: material.hsn,
      unit: booking.unit || material.unit,
      quantity: qty,
      rate,
      basic,
      gstRate,
      cgst,
      sgst,
      total,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    next(error);
  }
};
