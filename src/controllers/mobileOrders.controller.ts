import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Booking from "../models/Booking.model";
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

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const generateBookingId = async (): Promise<string> => {
  const count = await Booking.countDocuments();
  const timestamp = Date.now().toString().slice(-6);
  return `BK-${count + 1}-${timestamp}`;
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

interface CheckoutItem {
  materialId: string;
  quantity: number;
}

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

    const {
      items,
      paymentMethod,
      site,
      notes,
      couponCode,
      pincode: bodyPincode,
    } = req.body as {
      items?: CheckoutItem[];
      paymentMethod?: string;
      site?: string;
      notes?: string;
      couponCode?: string;
      pincode?: string;
    };

    // Optional per-line GST sent by the customer app. Supports two shapes:
    //   items: [{ materialId, quantity, gstAmount? }]  (preferred)
    //   gstAmounts: { [materialId]: number }           (fallback)
    // If absent, GST is derived from material.gst at create time.
    const gstByMaterialId = new Map<string, number>();
    if (Array.isArray(items)) {
      for (const it of items) {
        const g = Number((it as any)?.gstAmount);
        if (Number.isFinite(g)) gstByMaterialId.set(it.materialId, g);
      }
    }
    const gstAmounts = (req.body as any)?.gstAmounts;
    if (gstAmounts && typeof gstAmounts === "object") {
      for (const [k, v] of Object.entries(gstAmounts)) {
        const g = Number(v);
        if (Number.isFinite(g)) gstByMaterialId.set(k, g);
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError("Cart is empty.", 400);
    }

    // Hydrate materials in one go and validate
    const materialIds = items.map(i => i.materialId);
    const materials = await Material.find({
      _id: { $in: materialIds },
      isDeleted: false,
      status: "active",
    });

    if (materials.length === 0) {
      throw new AppError("None of the cart items are available.", 400);
    }

    const matMap = new Map(materials.map(m => [m._id.toString(), m]));

    // Evaluate the coupon (if any) once against the full cart so we can
    // distribute the discount across the bookings proportionally.
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

    // Pre-compute each line's gross total so we can split totalDiscount fairly
    const lines = items
      .map(it => {
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
    const grossTotal = lines.reduce((s, l) => s + l.gross, 0) || 1;

    // Resolve the delivery pincode. Vendors whose business pincode equals this
    // will see the (unassigned) order and the first to accept claims it.
    const userDoc = await User.findById(userId)
      .select("address.pincode")
      .lean();
    const sitePincodeMatch = String(site || "").match(/\b(\d{6})\b/);
    const deliveryPincode =
      (typeof bodyPincode === "string" && bodyPincode.trim()) ||
      (sitePincodeMatch ? sitePincodeMatch[1] : "") ||
      userDoc?.address?.pincode ||
      "";

    const created = [] as any[];
    let discountAllocated = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      // Last line absorbs rounding so the total discount matches exactly
      const lineDiscount =
        idx === lines.length - 1
          ? Math.max(0, totalDiscount - discountAllocated)
          : Math.round(
              ((line.gross / grossTotal) * totalDiscount) * 100,
            ) / 100;
      discountAllocated += lineDiscount;

      const totalAmount = Math.max(0, line.gross - lineDiscount);

      // GST: the totalAmount is treated as GST-inclusive. If the customer app
      // sends an explicit per-line gstAmount we honor it; otherwise we derive
      // the embedded GST from the material's gst rate (material.gst is a
      // percentage). If neither is available, gst is 0.
      const sentGst = gstByMaterialId.get(line.material._id.toString());
      let gstAmount = 0;
      if (sentGst !== undefined && Number.isFinite(sentGst) && sentGst > 0) {
        gstAmount = +sentGst.toFixed(2);
      } else {
        const rate = Number(line.material.gst) || 0;
        if (rate > 0) {
          // Embedded GST within the (inclusive) totalAmount.
          gstAmount = +(totalAmount - totalAmount / (1 + rate / 100)).toFixed(2);
        }
      }

      const bookingId = await generateBookingId();

      // No auto-assignment: the order is created unassigned and offered to all
      // vendors whose business pincode matches the delivery pincode. The first
      // vendor to accept claims it (see vendorOrders.updateOrderStatus).
      const booking = await Booking.create({
        bookingId,
        user: userId,
        material: line.material._id,
        vendor: undefined,
        quantity: line.quantity,
        unit: line.material.unit,
        price: line.price,
        totalAmount,
        gstAmount,
        discountAmount: +lineDiscount.toFixed(2),
        site,
        pincode: deliveryPincode || undefined,
        notes,
        paymentMethod,
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

    // Notify every active vendor whose business pincode matches the delivery
    // pincode that new claimable order(s) are available. First to accept wins.
    if (deliveryPincode) {
      const matchingVendors = await Vendor.find({
        "business.pincode": deliveryPincode,
        status: "active",
        isDeleted: false,
      })
        .select("_id")
        .lean();

      if (matchingVendors.length > 0) {
        const vendorIds = matchingVendors.map(v => v._id);
        await Notification.create({
          title: "New order available",
          message: `A new order is available in your area (pincode ${deliveryPincode}). Accept it before another vendor does.`,
          targetType: "specific",
          specificRecipients: { users: [], vendors: vendorIds, drivers: [] },
          sentTo: { userCount: 0, vendorCount: vendorIds.length, driverCount: 0 },
          status: "sent",
          sentAt: new Date(),
          // System-generated; stamp the customer as the initiator to satisfy
          // the required createdBy (no admin involved in this flow).
          createdBy: userId,
        });
      }
    }

    // Record redemption (one per checkout, not per booking)
    if (offerForRedemption && totalDiscount > 0) {
      await recordOfferRedemption(
        offerForRedemption._id.toString(),
        userId,
        created[0]?._id?.toString() || null,
        totalDiscount,
      );
    }

    res.status(201).json({
      success: true,
      message: `${created.length} order(s) placed successfully.`,
      data: created,
      discountApplied: totalDiscount,
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
const escapeHtml = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const money = (n: number): string =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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
      .populate("material", "name unit")
      .populate("vendor", "name business")
      .populate("user", "name mobile email")
      .lean();

    if (!booking) throw new AppError("Order not found.", 404);

    const qty = booking.quantity || 0;
    const unitPrice = booking.price || 0;
    const gstAmount = booking.gstAmount || 0;
    const discount = booking.discountAmount || 0;
    const total = booking.totalAmount || 0;
    const subtotal = Math.max(total - gstAmount + discount, 0);
    const issued = new Date(booking.createdAt).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const vendorName =
      booking.vendor?.business?.name || booking.vendor?.name || "OTG";

    const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Invoice ${escapeHtml(booking.bookingId)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1d262d;margin:0;padding:24px;background:#f5f5f5}
  .sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0;color:#E48714}
  .muted{color:#6a7282;font-size:13px}
  .row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  table{width:100%;border-collapse:collapse;margin-top:18px}
  th,td{text-align:left;padding:10px;border-bottom:1px solid #eee;font-size:14px}
  th{background:#faf6f0;color:#6a7282;font-weight:600}
  td.r,th.r{text-align:right}
  .totals{margin-top:16px;margin-left:auto;width:280px}
  .totals .row{padding:6px 0;font-size:14px}
  .grand{font-weight:700;font-size:16px;border-top:2px solid #E48714;padding-top:10px;margin-top:6px}
  .btn{display:inline-block;margin-top:20px;background:#E48714;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;border:0;font-size:14px;cursor:pointer}
  @media print{.btn{display:none}body{background:#fff;padding:0}.sheet{box-shadow:none}}
</style></head>
<body>
  <div class="sheet">
    <div class="row">
      <div><h1>Invoice</h1><div class="muted">${escapeHtml(vendorName)}</div></div>
      <div style="text-align:right">
        <div><b>#${escapeHtml(booking.bookingId)}</b></div>
        <div class="muted">Date: ${escapeHtml(issued)}</div>
        <div class="muted">Status: ${escapeHtml(booking.status)}</div>
      </div>
    </div>
    <div class="row" style="margin-top:16px">
      <div>
        <div class="muted">Billed To</div>
        <div><b>${escapeHtml(booking.user?.name || "Customer")}</b></div>
        <div class="muted">${escapeHtml(booking.user?.mobile || "")}</div>
        ${booking.site ? `<div class="muted">${escapeHtml(booking.site)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div class="muted">Payment</div>
        <div>${escapeHtml(booking.paymentStatus || "pending")}</div>
        ${booking.paymentMethod ? `<div class="muted">${escapeHtml(booking.paymentMethod)}</div>` : ""}
      </div>
    </div>
    <table>
      <thead><tr><th>Material</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr>
          <td>${escapeHtml(booking.material?.name || "Material")}</td>
          <td class="r">${escapeHtml(qty)} ${escapeHtml(booking.unit || booking.material?.unit || "")}</td>
          <td class="r">${money(unitPrice)}</td>
          <td class="r">${money(unitPrice * qty)}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span class="muted">Subtotal</span><span>${money(subtotal)}</span></div>
      ${discount ? `<div class="row"><span class="muted">Discount</span><span>- ${money(discount)}</span></div>` : ""}
      <div class="row"><span class="muted">GST</span><span>${money(gstAmount)}</span></div>
      <div class="row grand"><span>Total</span><span>${money(total)}</span></div>
    </div>
    <button class="btn" onclick="window.print()">Download / Print PDF</button>
  </div>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    next(error);
  }
};
