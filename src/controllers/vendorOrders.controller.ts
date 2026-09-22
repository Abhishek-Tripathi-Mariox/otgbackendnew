import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Booking, { pushStatus } from "../models/Booking.model";
import Vendor from "../models/Vendor.model";
import Driver from "../models/Driver.model";
import Material from "../models/Material.model";
import VendorMaterial from "../models/VendorMaterial.model";
import { AppError } from "../middlewares/errorHandler";
import { VendorRequest } from "../middlewares/vendorAuth.middleware";
import {
  findAssignableDrivers,
  findFirstAvailableDriver,
} from "../utils/vendorAllocation";
import { uploadBufferToS3 } from "../config/s3";
import { buildTaxInvoiceHtml } from "../utils/taxInvoiceHtml";
import { sendPush } from "../services/pushService";
import { notifyAdmin } from "../services/adminNotify";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const ALLOWED_QC_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_QC_BYTES = 10 * 1024 * 1024;

type UiStatus =
  | "Pending"
  | "Accepted"
  | "QC Pending"
  | "QC Approved"
  | "QC Rejected"
  | "Packed"
  | "Dispatched"
  | "In Transit"
  | "Delivered"
  | "Cancelled"
  // Dashboard-tile-only filters — not a single raw status (see listMyOrders).
  | "In Progress"
  | "Today's Dispatch"
  | "Ready for Dispatch";

// Map each real booking status to the label the vendor UI shows. `confirmed`
// is the legacy alias of `accepted`.
const RAW_TO_UI: Record<string, UiStatus> = {
  pending: "Pending",
  accepted: "Accepted",
  confirmed: "Accepted",
  qc_pending: "QC Pending",
  qc_approved: "QC Approved",
  qc_rejected: "QC Rejected",
  packed: "Packed",
  dispatched: "Dispatched",
  in_transit: "In Transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
  // Vendor rejected their assigned order — from the vendor's own point of
  // view this is functionally the same as cancelled (their involvement is
  // over); admin resolution (Phase 7 / Section I) happens on the admin side.
  vendor_rejected: "Cancelled",
};

// Reverse map for the ?status= list filter. Each UI label maps to the set of
// real statuses it covers (Accepted covers the legacy `confirmed`).
const UI_TO_RAW: Partial<Record<UiStatus, string[]>> = {
  Pending: ["pending"],
  Accepted: ["accepted", "confirmed"],
  "QC Pending": ["qc_pending"],
  "QC Approved": ["qc_approved"],
  "QC Rejected": ["qc_rejected"],
  Packed: ["packed"],
  Dispatched: ["dispatched"],
  "In Transit": ["in_transit"],
  Delivered: ["delivered"],
  Cancelled: ["cancelled", "vendor_rejected"],
  // Matches the Dashboard's own "In Progress" stat card definition
  // (vendorAuth.controller.ts's IN_PROGRESS_STATUSES) — accepted work not
  // yet dispatched.
  "In Progress": ["accepted", "confirmed", "qc_pending", "qc_approved", "packed"],
  // Matches the Dashboard's "Ready for Dispatch" Operations Snapshot row.
  "Ready for Dispatch": ["qc_approved", "packed"],
  // "Today's Dispatch" also needs a same-day date filter — handled specially
  // in listMyOrders below, this entry just supplies the status half.
  "Today's Dispatch": ["dispatched"],
};

const formatDate = (d?: Date | string | null): string => {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatBooking = (booking: any) => {
  const rawStatus = booking.status as string;
  const uiStatus: UiStatus = RAW_TO_UI[rawStatus] || "Pending";
  const material = booking.material;
  const categoryName =
    material?.category?.name ||
    (typeof material?.category === "string" ? material.category : "") ||
    "Material";

  const unit = booking.unit || material?.unit || "";
  const quantityText = `${booking.quantity} ${unit}`.trim();

  // Prefer the real delivery date once delivered; fall back to the dispatch
  // date, then to updatedAt as a last-resort proxy for the list "Due" column.
  const deliveryDate = formatDate(
    booking.deliveryDate ||
      booking.dispatch?.dispatchDate ||
      booking.updatedAt ||
      booking.createdAt,
  );

  const user = booking.user;
  const customerName = user?.name || "Customer";
  const customerMobile = user?.mobile || "";

  return {
    id: booking.bookingId,
    _id: booking._id,
    status: uiStatus,
    rawStatus,
    category: categoryName,
    quantity: quantityText,
    quantityValue: booking.quantity,
    unit,
    deliveryDate,
    location: booking.site || "",
    materialName: material?.name || "",
    materialImage: material?.images?.[0] || null,
    // `booking.price`/`totalAmount` are the CUSTOMER's paid price — never
    // exposed to the vendor app (access-control requirement: vendor must
    // never see OTG's price to the customer). Once Phase 5's real
    // Vendor→OTG rate (VendorMaterial.price) is wired into invoicing, a
    // vendor-appropriate `vendorAmount` can be added here instead.
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || "",
    notes: booking.notes || "",
    customer: {
      name: customerName,
      mobile: customerMobile,
    },
    qc: booking.qc || null,
    dispatch: booking.dispatch || null,
    statusHistory: booking.statusHistory || [],
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
};

const populateBooking = (q: any) =>
  q
    .populate({
      path: "material",
      select: "name images unit category gst",
      populate: { path: "category", select: "name" },
    })
    .populate("user", "name mobile");

// Resolve a booking owned by the vendor from either a Mongo _id or bookingId.
const findVendorBooking = async (vendorId: string, rawId: string) => {
  const raw = String(rawId || "").trim();
  const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
  const orQuery: any[] = isObjectId
    ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
    : [{ bookingId: raw.toUpperCase() }];
  return Booking.findOne({
    vendor: new mongoose.Types.ObjectId(vendorId),
    isDeleted: false,
    $or: orQuery,
  });
};

/**
 * GET /api/vendor/orders
 * Optional ?status=All Orders|Pending|Accepted|QC Pending|QC Approved|Packed|Dispatched|Delivered
 * Returns bookings assigned to this vendor, newest first.
 */
export const listMyOrders = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const statusParam = (req.query.status as string) || "All Orders";

    // Orders already assigned to this vendor (optionally filtered by status).
    const assigned: any = {
      vendor: new mongoose.Types.ObjectId(vendorId),
      isDeleted: false,
    };

    if (statusParam && statusParam !== "All Orders") {
      const list = UI_TO_RAW[statusParam as UiStatus];
      if (list && list.length) {
        assigned.status = { $in: list };
      }
      if (statusParam === "Today's Dispatch") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        assigned.updatedAt = { $gte: todayStart, $lte: todayEnd };
      }
    }

    // Section I (Phase 7): a vendor only ever sees orders already bound to
    // them — no more "claimable" unassigned orders shown by pincode match.
    // Vendor assignment now happens at checkout (customer selection) or via
    // explicit admin allocation, never by a vendor claiming it themselves.
    const bookings = await populateBooking(
      Booking.find(assigned).sort({ createdAt: -1 }).limit(100),
    );

    res.json({
      success: true,
      data: bookings.map(formatBooking),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/orders/:id
 * Accepts either bookingId (e.g. "BK-12-345678") or Mongo _id.
 */
export const getMyOrder = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const idQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    // Section I (Phase 7): only visible if already bound to this vendor — no
    // more claimable-by-pincode fallback.
    const booking = await populateBooking(
      Booking.findOne({
        isDeleted: false,
        vendor: new mongoose.Types.ObjectId(vendorId),
        $or: idQuery,
      }),
    );

    if (!booking) throw new AppError("Order not found", 404);

    res.json({ success: true, data: formatBooking(booking) });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/vendor/orders/:id/status  body: { action: "accept" | "reject" }
 * Lightweight accept/reject from the vendor list. Other transitions
 * (QC, packing, dispatch) will be added when those screens go live.
 */
export const updateOrderStatus = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const raw = String(req.params.id || "").trim();
    const { action, reason, reasonCategory } = req.body as {
      action?: string;
      reason?: string;
      // e.g. "damaged_goods" — a lightweight categorization tag, stored
      // alongside the free-text reason rather than as its own schema field.
      reasonCategory?: string;
    };

    const allowed = ["accept", "reject"];
    if (!action || !allowed.includes(action)) {
      throw new AppError(
        `Invalid action. Allowed: ${allowed.join(", ")}`,
        400,
      );
    }

    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const idQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const vendorObjId = new mongoose.Types.ObjectId(vendorId);

    // Section I (Phase 7): a vendor only ever acts on an order already bound
    // to them — there is no more unassigned order to claim.
    const booking = await Booking.findOne({
      isDeleted: false,
      vendor: vendorObjId,
      $or: idQuery,
    });
    if (!booking) throw new AppError("Order not found", 404);

    if (action === "accept") {
      if (booking.status !== "pending") {
        throw new AppError("Only pending orders can be accepted.", 400);
      }
      pushStatus(booking, "accepted");
    } else if (action === "reject") {
      // Rejection is allowed through QC/packing too (e.g. damaged goods
      // discovered during QC) — only once it's actually left the vendor
      // (dispatched/in_transit/delivered) is it too late to reject.
      if (
        ![
          "pending",
          "accepted",
          "confirmed",
          "qc_pending",
          "qc_approved",
          "packed",
        ].includes(booking.status)
      ) {
        throw new AppError("This order can no longer be rejected.", 400);
      }

      if (!Array.isArray(booking.rejectedByVendors)) booking.rejectedByVendors = [];
      booking.rejectedByVendors.push(vendorObjId);
      const reasonLabel = reasonCategory === "damaged_goods" ? "Damaged Goods" : null;
      if (reason || reasonLabel) {
        const tag = reasonLabel ? `[${reasonLabel}] ` : "";
        booking.notes = `${booking.notes ? booking.notes + "\n" : ""}Rejected: ${tag}${reason || ""}`.trim();
      }

      // Per the client's explicit requirement: a customer's selected vendor
      // rejecting an order must NOT auto-transfer to another vendor, auto-
      // cancel, or auto-refund. `booking.vendor` stays as-is (an audit trail
      // of who rejected) — admin resolves case-by-case via the existing
      // admin Bookings vendor picker (reassign) or the cancellation flow
      // (cancel + refund).
      pushStatus(
        booking,
        "vendor_rejected",
        reason ? `Declined by vendor: ${reason}` : "Declined by vendor",
      );
      notifyAdmin({
        title: "Vendor rejected an order — needs your attention",
        message: `Order ${booking.bookingId} was rejected by the assigned vendor${reason ? `: ${reason}` : ""}. Reassign a vendor or cancel the order.`,
        booking: booking._id,
        createdBy: vendorObjId,
      }).catch(() => {});
    }

    await booking.save({ validateModifiedOnly: true });
    const populated = await populateBooking(Booking.findById(booking._id));
    res.json({ success: true, data: formatBooking(populated) });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/orders/payments
 * List the vendor's payments grouped by status (Pending / Completed) plus totals.
 *
 * Semantics:
 *  - Completed: booking is delivered AND paymentStatus === 'completed'.
 *  - Pending:   booking is delivered AND paymentStatus !== 'completed'.
 * Cancelled / non-delivered bookings are excluded since no payment is owed yet.
 */
export const listPayments = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = new mongoose.Types.ObjectId(req.vendor!.id);

    const bookings = await Booking.find({
      vendor: vendorId,
      isDeleted: false,
      status: "delivered",
    })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    const payments = bookings.map((b: any) => {
      const isCompleted = b.paymentStatus === "completed";
      return {
        orderId: b.bookingId,
        payId: `PAY-${String(b._id).slice(-6).toUpperCase()}`,
        amount: b.totalAmount || 0,
        orderDate: b.createdAt,
        settlementDate: isCompleted ? b.updatedAt : null,
        method: isCompleted ? b.paymentMethod || "Bank Transfer" : null,
        status: isCompleted ? "Completed" : "Pending",
      };
    });

    const pending = payments.filter(p => p.status === "Pending");
    const completed = payments.filter(p => p.status === "Completed");
    const sum = (arr: any[]) => arr.reduce((s, p) => s + (p.amount || 0), 0);
    const pendingTotal = sum(pending);
    const completedTotal = sum(completed);

    res.json({
      success: true,
      data: payments,
      summary: {
        pendingTotal,
        pendingCount: pending.length,
        completedTotal,
        completedCount: completed.length,
        totalRevenue: pendingTotal + completedTotal,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/orders/summary/counts
 * Counts per UI status, used by dashboard tiles and the list header.
 */
export const getOrderCounts = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = new mongoose.Types.ObjectId(req.vendor!.id);

    const rows = await Booking.aggregate([
      { $match: { vendor: vendorId, isDeleted: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = {
      total: 0,
      Pending: 0,
      Accepted: 0,
      "QC Pending": 0,
      "QC Approved": 0,
      Packed: 0,
      Dispatched: 0,
      "In Transit": 0,
      Delivered: 0,
      Cancelled: 0,
    };

    rows.forEach(r => {
      counts.total += r.count;
      const ui = RAW_TO_UI[r._id as string];
      // Accepted aggregates both `accepted` and legacy `confirmed`.
      if (ui) counts[ui] = (counts[ui] || 0) + r.count;
    });

    res.json({ success: true, data: counts });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/orders/:id/invoice
 * Returns a fully-resolved invoice payload for the given booking — vendor
 * legal info, customer details, line item, and totals — so the mobile UI can
 * render or export the invoice without further lookups.
 */
export const getOrderInvoice = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking: any = await populateBooking(
      Booking.findOne({
        vendor: new mongoose.Types.ObjectId(vendorId),
        isDeleted: false,
        $or: orQuery,
      }),
    );

    if (!booking) throw new AppError("Order not found", 404);
    if (booking.status !== "delivered") {
      throw new AppError("Invoice is available once the order is delivered.", 400);
    }
    if (booking.paymentStatus !== "completed") {
      throw new AppError("Invoice is available once payment is confirmed.", 400);
    }

    const vendorDoc = await Vendor.findById(vendorId).select(
      "vendorCode name email mobile business",
    );
    if (!vendorDoc) throw new AppError("Vendor not found", 404);

    const material = booking.material;
    const categoryName =
      material?.category?.name ||
      (typeof material?.category === "string" ? material.category : "") ||
      "Material";

    const unit = booking.unit || material?.unit || "";
    const quantity = Number(booking.quantity) || 0;

    // This is the VENDOR's own invoice — it must be priced off the vendor's
    // own rate for this material (VendorMaterial.price, the Vendor→OTG
    // rate), never the customer's paid price (`booking.price`/
    // `totalAmount`), and taxed at the material's real GST rate, not a
    // hardcoded guess.
    const vendorMaterial = material?._id
      ? await VendorMaterial.findOne({
          vendor: new mongoose.Types.ObjectId(vendorId),
          material: material._id,
        })
          .select("price")
          .lean()
      : null;
    const rateSet = vendorMaterial?.price != null;
    const unitPrice = rateSet ? Number(vendorMaterial!.price) : 0;
    const gstRate = Number(material?.gst) || 0;

    const subtotal = +(unitPrice * quantity).toFixed(2);
    const gstAmount = +((subtotal * gstRate) / 100).toFixed(2);
    const total = +(subtotal + gstAmount).toFixed(2);

    const invoiceNo = `INV-${booking.bookingId}`;
    const issuedAt = booking.updatedAt || booking.createdAt;

    res.json({
      success: true,
      data: {
        invoiceNo,
        issuedAt,
        orderId: booking.bookingId,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod || null,
        deliveryDate: formatDate(booking.updatedAt || booking.createdAt),
        vendor: {
          code: vendorDoc.vendorCode || null,
          name: vendorDoc.business?.name || vendorDoc.name,
          contactName: vendorDoc.name,
          email: vendorDoc.email || null,
          mobile: vendorDoc.mobile,
          gstNumber: vendorDoc.business?.gstNumber || null,
          panNumber: vendorDoc.business?.panNumber || null,
          address: vendorDoc.business?.address || null,
          city: vendorDoc.business?.city || null,
          state: vendorDoc.business?.state || null,
          pincode: vendorDoc.business?.pincode || null,
        },
        customer: {
          name: booking.buyerDetails?.name || booking.user?.name || "Customer",
          mobile: booking.buyerDetails?.mobile || booking.user?.mobile || null,
          site: booking.buyerDetails?.deliveryAddress || booking.site || null,
        },
        item: {
          materialName: material?.name || "",
          category: categoryName,
          unit,
          quantity,
          unitPrice,
        },
        totals: {
          subtotal,
          gstRate,
          gstAmount,
          total,
          rateSet,
        },
        notes: booking.notes || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/vendor/orders/:bookingId/qc
 * Body: { materialPhotos?: string[], packagingPhotos?: string[], note?: string }
 * Records QC submission and moves the order to `qc_approved`. Photos are plain
 * URL/strings (already-uploaded URLs) — there is NO multipart handling here.
 * Allowed from: accepted | confirmed (legacy) | qc_pending.
 */
/**
 * POST /api/vendor/orders/upload  body: { file: "data:image/...;base64,..." }
 * Uploads a single QC image to S3 and returns its URL. The vendor app calls
 * this per picked photo, then sends the URLs to submitQC.
 */
export const uploadVendorImage = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { file } = req.body as { file?: string };
    if (!file || typeof file !== "string" || !file.startsWith("data:")) {
      throw new AppError("file (base64 data URI) is required", 400);
    }
    const match = file.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
    if (!match) throw new AppError("Invalid base64 file payload", 400);

    const mime = match[1];
    const payload = match[2];
    if (!ALLOWED_QC_MIME.includes(mime)) {
      throw new AppError("Only JPG, PNG, WebP images or PDF are allowed.", 400);
    }
    const buffer = Buffer.from(payload, "base64");
    if (buffer.length === 0) throw new AppError("Empty file payload", 400);
    if (buffer.length > MAX_QC_BYTES) {
      throw new AppError("Image must be 7 MB or smaller.", 400);
    }

    const url = await uploadBufferToS3(buffer, "vendor/qc", mime);
    res.json({ success: true, data: { url } });
  } catch (error) {
    next(error);
  }
};

export const submitQC = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const { materialPhotos, packagingPhotos, note } = req.body as {
      materialPhotos?: string[];
      packagingPhotos?: string[];
      note?: string;
    };

    const booking = await findVendorBooking(vendorId, req.params.id);
    if (!booking) throw new AppError("Order not found", 404);

    if (
      !["accepted", "confirmed", "qc_pending", "qc_rejected"].includes(
        booking.status,
      )
    ) {
      throw new AppError(
        "QC can only be submitted on accepted orders.",
        400,
      );
    }

    booking.qc = {
      submittedAt: new Date(),
      materialPhotos: Array.isArray(materialPhotos) ? materialPhotos : [],
      packagingPhotos: Array.isArray(packagingPhotos) ? packagingPhotos : [],
      note: note || undefined,
    };
    // QC photos are submitted for ADMIN review — the order waits at
    // `qc_pending` until an admin approves it (then it becomes `qc_approved`
    // and the vendor can pack). It is NOT auto-approved here.
    pushStatus(booking, "qc_pending", note);

    await booking.save({ validateModifiedOnly: true });
    const populated = await populateBooking(Booking.findById(booking._id));
    res.json({ success: true, data: formatBooking(populated) });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/vendor/orders/:bookingId/pack  body: { note?: string }
 * Moves a QC-approved order to `packed`.
 */
export const packOrder = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const { note } = req.body as { note?: string };

    const booking = await findVendorBooking(vendorId, req.params.id);
    if (!booking) throw new AppError("Order not found", 404);

    if (booking.status !== "qc_approved") {
      throw new AppError(
        "QC must be approved by admin before packing.",
        400,
      );
    }

    pushStatus(booking, "packed", note);

    await booking.save({ validateModifiedOnly: true });
    const populated = await populateBooking(Booking.findById(booking._id));
    res.json({ success: true, data: formatBooking(populated) });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/vendor/orders/:bookingId/dispatch
 * Body: { dispatchDate?, dispatchTime?, vehicleNumber?, driverId? }
 * Records dispatch details, moves status to `dispatched`, and ASSIGNS A DRIVER.
 * If `driverId` is supplied it is used; otherwise the first eligible
 * (active + approved) driver is auto-assigned. This assignment is the
 * cross-app link that makes the order visible in the driver app.
 */
export const dispatchOrder = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const { dispatchDate, dispatchTime, vehicleNumber, driverId } =
      req.body as {
        dispatchDate?: string;
        dispatchTime?: string;
        vehicleNumber?: string;
        driverId?: string;
      };

    const booking = await findVendorBooking(vendorId, req.params.id);
    if (!booking) throw new AppError("Order not found", 404);

    if (!["packed", "qc_approved"].includes(booking.status)) {
      throw new AppError(
        "Only packed orders can be dispatched.",
        400,
      );
    }

    // Never trust client-only date validation (same rationale throughout —
    // e.g. validateBuyerDetails in mobileOrders.controller.ts).
    if (dispatchDate) {
      const parsedDate = new Date(dispatchDate);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      if (!Number.isNaN(parsedDate.getTime()) && parsedDate.getTime() < startOfToday.getTime()) {
        throw new AppError("Dispatch date cannot be in the past.", 400);
      }
    }

    // Vehicle-capacity matching: the weight this delivery needs, used to
    // exclude under-capacity drivers from explicit-pick validation and the
    // auto-assign fallback below (see Driver.model.ts's liftingCapacityKg).
    const material = await Material.findById(booking.material)
      .select("weightPerUnit")
      .lean();
    const requiredWeightKg = material?.weightPerUnit
      ? material.weightPerUnit * booking.quantity
      : undefined;

    // Resolve the driver: explicit pick, else auto-assign first eligible.
    let driverName: string | undefined;
    let assignedVehicle: string | undefined;
    let assignedFcmToken: string | undefined;
    if (driverId) {
      if (!/^[a-fA-F0-9]{24}$/.test(driverId)) {
        throw new AppError("Invalid driverId.", 400);
      }
      const driver = await Driver.findOne({
        _id: driverId,
        status: "active",
        approvalStatus: "approved",
        isDeleted: false,
      })
        .select("name vehicles.registrationNo vehicles.liftingCapacityKg deviceInfo.fcmToken")
        .lean();
      if (!driver) {
        throw new AppError("Selected driver is not assignable.", 400);
      }
      if (requiredWeightKg) {
        const capacities = (driver.vehicles || [])
          .map((v: any) => Number(v.liftingCapacityKg) || 0)
          .filter((n: number) => n > 0);
        const maxCapacity = capacities.length ? Math.max(...capacities) : 0;
        if (maxCapacity > 0 && maxCapacity < requiredWeightKg) {
          throw new AppError(
            `Selected driver's vehicle capacity is too low for this delivery (needs at least ${requiredWeightKg}kg).`,
            400,
          );
        }
      }
      booking.driver = driver._id as mongoose.Types.ObjectId;
      driverName = driver.name;
      assignedVehicle = driver.vehicles?.[0]?.registrationNo;
      assignedFcmToken = (driver as any).deviceInfo?.fcmToken;
    } else if (booking.driver) {
      // A driver already early-claimed this order (right after the vendor
      // accepted it, matched by pincode) — keep them rather than picking a
      // different one.
      const existing = await Driver.findById(booking.driver)
        .select("name vehicles.registrationNo deviceInfo.fcmToken")
        .lean();
      if (existing) {
        driverName = existing.name;
        assignedVehicle = existing.vehicles?.[0]?.registrationNo;
        assignedFcmToken = (existing as any).deviceInfo?.fcmToken;
      }
    } else {
      const driver = await findFirstAvailableDriver(requiredWeightKg);
      if (driver) {
        booking.driver = driver._id;
        driverName = driver.name;
        assignedVehicle = driver.vehicles?.[0]?.registrationNo;
        assignedFcmToken = driver.deviceInfo?.fcmToken;
      }
    }

    booking.dispatch = {
      dispatchedAt: new Date(),
      dispatchDate: dispatchDate ? new Date(dispatchDate) : undefined,
      dispatchTime: dispatchTime || undefined,
      vehicleNumber: vehicleNumber || assignedVehicle || undefined,
      driverName: driverName || undefined,
    };
    // Clear any prior rejection so a re-assigned driver sees a fresh offer.
    booking.driverRejectedAt = undefined;
    pushStatus(booking, "dispatched");

    await booking.save();

    // New delivery request → push to the assigned driver (fixes the driver
    // app relying purely on 20s polling to learn about a dispatched order).
    if (assignedFcmToken) {
      sendPush(
        [assignedFcmToken],
        "New delivery assigned",
        `Order ${booking.bookingId} has been dispatched to you. Tap to view.`,
        { bookingId: String(booking._id) },
      ).catch(() => {});
    }
    notifyAdmin({
      title: "Order dispatched",
      message: `Order ${booking.bookingId} was dispatched${driverName ? ` to driver ${driverName}` : ""}.`,
      booking: booking._id,
      createdBy: vendorId,
    }).catch(() => {});

    const populated = await populateBooking(Booking.findById(booking._id));
    res.json({ success: true, data: formatBooking(populated) });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/orders/assignable-drivers
 * Returns active + approved drivers for the dispatch driver picker.
 * Shape: [{ id, name, vehicleNumber }]
 */
export const getAssignableDrivers = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Only show drivers whose registered pincode matches this vendor's pincode.
    const vendorDoc = await Vendor.findById(req.vendor!.id)
      .select("business.pincode")
      .lean();

    // Optional ?bookingId — when given, excludes drivers whose vehicle can't
    // carry that booking's required weight (vehicle-capacity matching).
    let requiredWeightKg: number | undefined;
    const bookingId = req.query.bookingId as string | undefined;
    if (bookingId) {
      const booking = await findVendorBooking(req.vendor!.id, bookingId);
      if (booking) {
        const material = await Material.findById(booking.material)
          .select("weightPerUnit")
          .lean();
        requiredWeightKg = material?.weightPerUnit
          ? material.weightPerUnit * booking.quantity
          : undefined;
      }
    }

    const drivers = await findAssignableDrivers(
      vendorDoc?.business?.pincode,
      requiredWeightKg,
    );
    res.json({
      success: true,
      data: drivers.map(d => ({
        id: String(d._id),
        name: d.name || "Driver",
        vehicleNumber: d.vehicles?.[0]?.registrationNo || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// ---------------- Printable vendor tax-invoice (GST format) ----------------

// GET /api/vendor/orders/:id/invoice/html?token=...
// Printable GST tax invoice (vendor -> customer). Authenticated via the token
// query param so it can be opened directly in the browser for print/save-as-PDF.
export const getVendorInvoiceHtml = async (
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

    let vendorId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id: string;
        type: string;
      };
      if (decoded.type !== "vendor") throw new AppError("Invalid token", 401);
      vendorId = decoded.id;
    } catch {
      throw new AppError("Invalid or expired token", 401);
    }

    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking: any = await Booking.findOne({
      vendor: new mongoose.Types.ObjectId(vendorId),
      isDeleted: false,
      $or: orQuery,
    })
      .populate("material", "name unit gst hsn")
      .populate("user", "name mobile email address")
      .populate(
        "vendor",
        "name email mobile business bankDetails vendorCode",
      )
      .lean();

    if (!booking) throw new AppError("Order not found.", 404);
    if (booking.status !== "delivered") {
      throw new AppError("Invoice is available once the order is delivered.", 400);
    }
    if (booking.paymentStatus !== "completed") {
      throw new AppError("Invoice is available once payment is confirmed.", 400);
    }

    const vendor = booking.vendor || {};
    const biz = vendor.business || {};
    const bank = vendor.bankDetails || {};
    const material = booking.material || {};
    const cust = booking.user || {};

    const qty = Number(booking.quantity || 0);

    // Vendor's own invoice must be priced off the vendor's own rate
    // (VendorMaterial.price, the Vendor→OTG rate) — never the customer's
    // paid price (booking.totalAmount/gstAmount), which is what this used
    // to read (a confirmed access-control/billing-logic bug: the vendor's
    // "invoice" was silently just the customer's total).
    const vendorMaterial = material?._id
      ? await VendorMaterial.findOne({
          vendor: new mongoose.Types.ObjectId(vendorId),
          material: material._id,
        })
          .select("price")
          .lean()
      : null;
    const rate = vendorMaterial?.price != null ? Number(vendorMaterial.price) : 0;
    const gstRate = Number(material.gst || 0);
    const basic = +(rate * qty).toFixed(2);
    const gstAmount = +((basic * gstRate) / 100).toFixed(2);
    const cgst = gstAmount / 2;
    const sgst = gstAmount / 2;
    const total = +(basic + gstAmount).toFixed(2);
    const issued = new Date(booking.createdAt).toLocaleDateString("en-IN");
    const vendorName = biz.name || vendor.name || "Vendor Name";

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
      // Frozen per-order snapshot, not a live User read (see
      // mobileOrders.controller.ts's getOrderInvoiceHtml for the rationale).
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
