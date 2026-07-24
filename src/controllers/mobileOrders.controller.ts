import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Booking, { isCodPaymentMethod } from "../models/Booking.model";
import Material from "../models/Material.model";
import User from "../models/User.model";
import Vendor from "../models/Vendor.model";
import Notification from "../models/Notification.model";
import { AppError } from "../middlewares/errorHandler";
import { UserRequest } from "../middlewares/userAuth.middleware";
import {
  evaluateOffer,
  findOfferByCode,
  resolveCart,
} from "../services/offerEngine";
import { recordOfferRedemption } from "./mobileOffers.controller";
import { buildTaxInvoiceHtml } from "../utils/taxInvoiceHtml";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const generateBookingId = async (): Promise<string> => {
  const count = await Booking.countDocuments();
  const timestamp = Date.now().toString().slice(-6);
  return `BK-${count + 1}-${timestamp}`;
};

export interface CheckoutItem {
  materialId: string;
  quantity: number;
  gstAmount?: number;
}

export interface CartLine {
  material: any;
  quantity: number;
  price: number;
  gstAmount: number;
  lineDiscount: number;
  totalAmount: number;
}

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

  const rawLines = items
    .map((it) => {
      const m = matMap.get(it.materialId);
      if (!m) return null;
      const quantity = Math.max(m.minOrderQty || 1, Number(it.quantity) || 1);
      const price = m.finalSellingPrice ?? m.sellingPrice ?? 0;
      return { material: m, quantity, price, gross: price * quantity };
    })
    .filter(Boolean) as Array<{
    material: any;
    quantity: number;
    price: number;
    gross: number;
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

    const totalAmount = Math.max(0, line.gross - lineDiscount);

    const sentGst = gstByMaterialId.get(line.material._id.toString());
    let gstAmount = 0;
    if (sentGst !== undefined && Number.isFinite(sentGst) && sentGst > 0) {
      gstAmount = +sentGst.toFixed(2);
    } else {
      const rate = Number(line.material.gst) || 0;
      if (rate > 0) {
        gstAmount = +(totalAmount - totalAmount / (1 + rate / 100)).toFixed(2);
      }
    }

    lines.push({
      material: line.material,
      quantity: line.quantity,
      price: line.price,
      gstAmount,
      lineDiscount: +lineDiscount.toFixed(2),
      totalAmount,
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
  },
): Promise<any[]> => {
  const { lines, deliveryPincode, totalDiscount, offerForRedemption } = pricing;
  const created: any[] = [];

  for (const line of lines) {
    const bookingId = await generateBookingId();

    const booking = await Booking.create({
      bookingId,
      user: userId,
      material: line.material._id,
      vendor: undefined,
      quantity: line.quantity,
      unit: line.material.unit,
      price: line.price,
      totalAmount: line.totalAmount,
      gstAmount: line.gstAmount,
      discountAmount: line.lineDiscount,
      site: opts.site,
      pincode: deliveryPincode || undefined,
      notes: opts.notes,
      paymentMethod: opts.paymentMethod,
      paymentGateway: opts.paymentGateway,
      razorpayOrderId: opts.razorpayOrderId,
      paymentStatus: opts.paymentStatus,
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

  if (deliveryPincode) {
    const matchingVendors = await Vendor.find({
      "business.pincode": new RegExp(deliveryPincode),
      status: "active",
      approvalStatus: "approved",
      isDeleted: false,
    })
      .select("_id")
      .lean();

    if (matchingVendors.length > 0) {
      const vendorIds = matchingVendors.map((v) => v._id);
      await Notification.create({
        title: "New order available",
        message: `A new order is available in your area (pincode ${deliveryPincode}). Accept it before another vendor does.`,
        targetType: "specific",
        specificRecipients: { users: [], vendors: vendorIds, drivers: [] },
        sentTo: { userCount: 0, vendorCount: vendorIds.length, driverCount: 0 },
        status: "sent",
        sentAt: new Date(),
        createdBy: userId,
      });
    }
  }

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
          "packed",
          "dispatched",
          "in_transit",
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

    const { items, paymentMethod, site, notes, couponCode, pincode, gstAmounts } =
      req.body as {
        items?: CheckoutItem[];
        paymentMethod?: string;
        site?: string;
        notes?: string;
        couponCode?: string;
        pincode?: string;
        gstAmounts?: Record<string, number>;
      };

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
    });

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

    const vendor = booking.vendor || {};
    const biz = vendor.business || {};
    const bank = vendor.bankDetails || {};
    const material = booking.material || {};
    const cust = booking.user || {};

    const qty = Number(booking.quantity || 0);
    const total = Number(booking.totalAmount || 0);
    const gstAmount = Number(booking.gstAmount || 0);
    const basic = Math.max(total - gstAmount, 0);
    const gstRate = Number(material.gst || 0);
    const cgst = gstAmount / 2;
    const sgst = gstAmount / 2;
    const rate = qty ? basic / qty : basic;
    const issued = new Date(booking.createdAt).toLocaleDateString("en-IN");
    const vendorName = biz.name || vendor.name || "OTG";

    const html = buildTaxInvoiceHtml({
      sellerName: vendorName,
      sellerAddress: biz.address,
      sellerCity: biz.city,
      sellerPincode: biz.pincode,
      sellerState: biz.state,
      sellerGstin: biz.gstNumber,
      sellerMobile: vendor.mobile,
      sellerEmail: vendor.email,
      sellerPan: biz.panNumber,
      bankAccountNumber: bank.accountNumber,
      bankIfsc: bank.ifscCode,
      bankName: bank.bankName,
      invoiceNo: booking.bookingId,
      orderNo: booking.bookingId,
      issuedDate: issued,
      paymentMethod: booking.paymentMethod,
      consigneeName: cust.name || "Customer",
      consigneeAddress: booking.site || cust.address?.full,
      consigneeMobile: cust.mobile,
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
