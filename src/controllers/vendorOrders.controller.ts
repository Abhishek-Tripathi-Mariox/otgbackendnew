import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Booking, { pushStatus } from "../models/Booking.model";
import Vendor from "../models/Vendor.model";
import Driver from "../models/Driver.model";
import { AppError } from "../middlewares/errorHandler";
import { VendorRequest } from "../middlewares/vendorAuth.middleware";
import {
  findAssignableDrivers,
  findFirstAvailableDriver,
} from "../utils/vendorAllocation";

type UiStatus =
  | "Pending"
  | "Accepted"
  | "QC Pending"
  | "QC Approved"
  | "Packed"
  | "Dispatched"
  | "In Transit"
  | "Delivered"
  | "Cancelled";

// Map each real booking status to the label the vendor UI shows. `confirmed`
// is the legacy alias of `accepted`.
const RAW_TO_UI: Record<string, UiStatus> = {
  pending: "Pending",
  accepted: "Accepted",
  confirmed: "Accepted",
  qc_pending: "QC Pending",
  qc_approved: "QC Approved",
  packed: "Packed",
  dispatched: "Dispatched",
  in_transit: "In Transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// Reverse map for the ?status= list filter. Each UI label maps to the set of
// real statuses it covers (Accepted covers the legacy `confirmed`).
const UI_TO_RAW: Partial<Record<UiStatus, string[]>> = {
  Pending: ["pending"],
  Accepted: ["accepted", "confirmed"],
  "QC Pending": ["qc_pending"],
  "QC Approved": ["qc_approved"],
  Packed: ["packed"],
  Dispatched: ["dispatched"],
  "In Transit": ["in_transit"],
  Delivered: ["delivered"],
  Cancelled: ["cancelled"],
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
    price: booking.price,
    totalAmount: booking.totalAmount,
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
      select: "name images unit category",
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

    const filter: any = {
      vendor: new mongoose.Types.ObjectId(vendorId),
      isDeleted: false,
    };

    if (statusParam && statusParam !== "All Orders") {
      const rawList = UI_TO_RAW[statusParam as UiStatus];
      if (rawList && rawList.length) {
        filter.status = { $in: rawList };
      }
    }

    const bookings = await populateBooking(
      Booking.find(filter).sort({ createdAt: -1 }).limit(100),
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
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking = await populateBooking(
      Booking.findOne({
        vendor: new mongoose.Types.ObjectId(vendorId),
        isDeleted: false,
        $or: orQuery,
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
    const { action, reason } = req.body as { action?: string; reason?: string };

    const allowed = ["accept", "reject"];
    if (!action || !allowed.includes(action)) {
      throw new AppError(
        `Invalid action. Allowed: ${allowed.join(", ")}`,
        400,
      );
    }

    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking = await Booking.findOne({
      vendor: new mongoose.Types.ObjectId(vendorId),
      isDeleted: false,
      $or: orQuery,
    });

    if (!booking) throw new AppError("Order not found", 404);

    if (action === "accept") {
      if (booking.status !== "pending") {
        throw new AppError("Only pending orders can be accepted.", 400);
      }
      pushStatus(booking, "accepted");
    } else if (action === "reject") {
      if (!["pending", "accepted", "confirmed"].includes(booking.status)) {
        throw new AppError("This order can no longer be rejected.", 400);
      }
      pushStatus(booking, "cancelled", reason);
      if (reason) {
        booking.notes = `${booking.notes ? booking.notes + "\n" : ""}Rejected: ${reason}`;
      }
    }

    await booking.save();
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

// Default GST rate for construction-materials line items. If the vendor has a
// GSTIN on file we surface a tax breakup; if not, we present the invoice as
// pre-tax only (still legitimate for non-registered vendors).
const DEFAULT_GST_RATE = 18;

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
    const unitPrice = Number(booking.price) || 0;
    const total = Number(booking.totalAmount) || quantity * unitPrice;

    const hasGst = Boolean(vendorDoc.business?.gstNumber);
    // Treat `totalAmount` as the gross (tax-inclusive) amount when the vendor
    // is GST-registered; otherwise treat it as the flat total.
    let subtotal = total;
    let gstRate = 0;
    let gstAmount = 0;
    if (hasGst) {
      gstRate = DEFAULT_GST_RATE;
      subtotal = +(total / (1 + gstRate / 100)).toFixed(2);
      gstAmount = +(total - subtotal).toFixed(2);
    }

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
          name: booking.user?.name || "Customer",
          mobile: booking.user?.mobile || null,
          site: booking.site || null,
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

    if (!["accepted", "confirmed", "qc_pending"].includes(booking.status)) {
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
    pushStatus(booking, "qc_approved", note);

    await booking.save();
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

    if (!["qc_approved", "qc_pending"].includes(booking.status)) {
      throw new AppError(
        "Only QC-approved orders can be packed.",
        400,
      );
    }

    pushStatus(booking, "packed", note);

    await booking.save();
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

    // Resolve the driver: explicit pick, else auto-assign first eligible.
    let driverName: string | undefined;
    let assignedVehicle: string | undefined;
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
        .select("name vehicles.registrationNo")
        .lean();
      if (!driver) {
        throw new AppError("Selected driver is not assignable.", 400);
      }
      booking.driver = driver._id as mongoose.Types.ObjectId;
      driverName = driver.name;
      assignedVehicle = driver.vehicles?.[0]?.registrationNo;
    } else {
      const driver = await findFirstAvailableDriver();
      if (driver) {
        booking.driver = driver._id;
        driverName = driver.name;
        assignedVehicle = driver.vehicles?.[0]?.registrationNo;
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
  _req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const drivers = await findAssignableDrivers();
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
