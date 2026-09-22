import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Quotation, {
  IQuotationDocument,
} from "../models/Quotation.model";
import Vendor from "../models/Vendor.model";
import User from "../models/User.model";
import Booking, { IBuyerDetails } from "../models/Booking.model";
import Material from "../models/Material.model";
import { AuthRequest } from "../types";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { VendorRequest } from "../middlewares/vendorAuth.middleware";
import { AppError } from "../middlewares/errorHandler";
import { deleteFromS3 } from "../config/s3";
import { sendMail } from "../services/mailer";
import { sendPush } from "../services/pushService";
import { notifyAdmin } from "../services/adminNotify";
import { generateBookingId } from "./mobileOrders.controller";

const normalizeMobile = (m: string): string =>
  String(m || "").replace(/^\+91/, "").replace(/\s+/g, "").trim();

// ===================== CUSTOMER =====================

const sanitizeItem = (raw: any) => {
  if (!raw || typeof raw !== "object") return null;
  const item: any = {};
  if (raw.categoryId) item.categoryId = raw.categoryId;
  if (raw.categoryName) item.categoryName = String(raw.categoryName).trim();
  if (raw.subCategoryId) item.subCategoryId = raw.subCategoryId;
  if (raw.subCategoryName)
    item.subCategoryName = String(raw.subCategoryName).trim();
  if (raw.materialId) item.materialId = raw.materialId;
  if (raw.materialName) item.materialName = String(raw.materialName).trim();
  if (raw.quantity !== undefined && raw.quantity !== null)
    item.quantity = String(raw.quantity).trim();
  if (raw.unit) item.unit = String(raw.unit).trim();
  if (raw.note) item.note = String(raw.note).trim();
  // Drop fully empty items
  const hasAny =
    item.categoryName ||
    item.subCategoryName ||
    item.materialName ||
    item.quantity ||
    item.unit ||
    item.note;
  return hasAny ? item : null;
};

export const createQuotation = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      customerType,
      name,
      mobile,
      email,
      company,
      address,
      landmark,
      items,
      category,
      quantity,
      unit,
      materialRequirement,
    } = req.body;

    const cleanMobile = normalizeMobile(mobile);

    if (!name?.trim()) throw new AppError("Name is required", 400);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new AppError("Enter a valid 10-digit mobile number", 400);
    }

    // When submitted as multipart/form-data (PDF attached), array/object fields
    // arrive as JSON strings — normalise them back to objects.
    let itemsInput = items;
    if (typeof itemsInput === "string") {
      try {
        itemsInput = JSON.parse(itemsInput);
      } catch {
        itemsInput = [];
      }
    }

    let cleanedItems: any[] = [];
    if (Array.isArray(itemsInput) && itemsInput.length > 0) {
      cleanedItems = itemsInput
        .map(sanitizeItem)
        .filter((i) => i !== null) as any[];
      if (cleanedItems.length === 0) {
        throw new AppError("Please add at least one item", 400);
      }
    }

    // Optional PDF attached by the customer (e.g. a BOQ / requirement list).
    const uploadedPdf = req.file as
      | (Express.Multer.File & { location?: string })
      | undefined;
    const quotationPdf = uploadedPdf?.location
      ? {
          url: uploadedPdf.location,
          name: uploadedPdf.originalname,
          uploadedAt: new Date(),
        }
      : undefined;

    const quotation = await Quotation.create({
      user: req.user?.id || undefined,
      customerType: customerType || "individual",
      name: name.trim(),
      mobile: cleanMobile,
      email: email?.trim() || undefined,
      company: company?.trim() || undefined,
      address: address?.trim() || undefined,
      landmark: landmark?.trim() || undefined,
      items: cleanedItems,
      // Legacy fallbacks (only filled if items[] not provided)
      category: cleanedItems.length === 0 && category?.trim()
        ? category.trim()
        : undefined,
      quantity:
        cleanedItems.length === 0 && quantity
          ? String(quantity).trim()
          : undefined,
      unit: cleanedItems.length === 0 && unit ? String(unit).trim() : undefined,
      materialRequirement: materialRequirement?.trim() || undefined,
      quotationPdf,
      status: "new",
    });

    // Best-effort notification — the Quotations admin page today only
    // surfaces new requests via polling, so this gives admins an immediate
    // heads-up. Never blocks the response on mail delivery.
    const adminEmail = process.env.ADMIN_EMAIL || "admin@otg.com";
    sendMail({
      to: adminEmail,
      subject: `New bulk quotation request — ${quotation.quotationCode}`,
      html: `
        <p>A new quotation request has been submitted.</p>
        <ul>
          <li><b>Code:</b> ${quotation.quotationCode}</li>
          <li><b>Name:</b> ${quotation.name}</li>
          <li><b>Mobile:</b> ${quotation.mobile}</li>
          <li><b>Type:</b> ${quotation.customerType}</li>
          <li><b>Items:</b> ${cleanedItems.length || 1}</li>
        </ul>
        <p>Please review and respond in the admin panel.</p>
      `,
    }).catch(() => {});

    notifyAdmin({
      title: "New bulk quotation request",
      message: `${quotation.name} (${quotation.mobile}) submitted a new quotation request — ${quotation.quotationCode}.`,
      quotation: quotation._id,
      createdBy: quotation.user || undefined,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Quotation request submitted successfully",
      data: quotation,
    });
  } catch (error) {
    next(error);
  }
};

// Customer fetches their quotation list (logged-in)
export const listMyQuotations = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.id) throw new AppError("Authentication required", 401);
    const quotations = await Quotation.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, data: quotations });
  } catch (error) {
    next(error);
  }
};

export const getMyQuotation = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.id) throw new AppError("Authentication required", 401);
    const { id } = req.params;
    const quotation = await Quotation.findOne({ _id: id, user: req.user.id });
    if (!quotation) throw new AppError("Quotation not found", 404);
    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
};

/**
 * Auto-generates one Booking per quotation line item that has a resolvable
 * catalog materialId, when a bulk quotation is accepted. Admin only ever
 * negotiates a single lump-sum `quotedPrice` for the whole quotation — there
 * is no per-item pricing anywhere in the admin UI — so each item's price is
 * derived as a flat per-unit rate (quotedPrice / total quantity across all
 * items), which reconstructs exactly back to the agreed lump sum when every
 * item is bookable. Items without a materialId (free-text/category-only
 * requests) can't become a Booking (Booking.material is a required catalog
 * reference) and are silently skipped — admin must handle those manually.
 * Never throws — quotation acceptance must never be blocked by this.
 */
const generateBookingsFromQuotation = async (
  quotation: IQuotationDocument,
): Promise<void> => {
  try {
    if (!quotation.user) return; // guest quotation — no account to attach bookings to
    if (await Booking.exists({ quotationRef: quotation._id })) return; // already generated

    const lumpSum = Number(quotation.quotedPrice);
    if (!Number.isFinite(lumpSum) || lumpSum <= 0) return;
    if (!Array.isArray(quotation.items) || quotation.items.length === 0) return;

    const parseQty = (raw?: string): number => {
      const n = parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : 1;
    };

    const totalQty = quotation.items.reduce(
      (sum, it) => sum + parseQty(it.quantity),
      0,
    );
    if (totalQty <= 0) return;
    const unitRate = lumpSum / totalQty;

    const buyerDetails: Partial<IBuyerDetails> = {
      accountType: quotation.customerType === "individual" ? "individual" : "company",
      name: quotation.name,
      mobile: quotation.mobile,
      email: quotation.email,
      deliveryAddress: quotation.address || "",
      landmark: quotation.landmark,
      companyName: quotation.company,
    };

    for (const item of quotation.items) {
      if (!item.materialId) continue;
      try {
        const material = await Material.findById(item.materialId)
          .select("unit")
          .lean();
        if (!material) continue;

        const qty = parseQty(item.quantity);
        const price = +unitRate.toFixed(2);
        const totalAmount = +(price * qty).toFixed(2);
        const bookingId = await generateBookingId();

        await Booking.create({
          bookingId,
          user: quotation.user,
          vendor: quotation.assignedVendor || undefined,
          material: item.materialId,
          quantity: qty,
          unit: item.unit || (material as any).unit || "unit",
          price,
          totalAmount,
          site: quotation.address,
          buyerDetails,
          quotationRef: quotation._id,
          paymentGateway: "manual",
          paymentStatus: "pending",
          notes: `Auto-generated from accepted bulk quotation ${quotation.quotationCode}.`,
          createdBy: quotation.user,
          statusHistory: [{ status: "pending", at: new Date() }],
        });
      } catch (itemError) {
        console.error(
          `[quotation] Failed to auto-generate booking for item (material ${item.materialId}) on quotation ${quotation.quotationCode}:`,
          itemError,
        );
      }
    }
  } catch (error) {
    console.error(
      "[quotation] Failed to auto-generate bookings on acceptance:",
      error,
    );
  }
};

// Customer accepts or rejects a quote the admin has sent back
export const setMyQuotationStatus = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.id) throw new AppError("Authentication required", 401);
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (status !== "accepted" && status !== "rejected") {
      throw new AppError("Status must be 'accepted' or 'rejected'", 400);
    }

    const quotation = await Quotation.findOne({ _id: id, user: req.user.id });
    if (!quotation) throw new AppError("Quotation not found", 404);

    // A customer may only act on a quote the admin has already sent — not on
    // a request that is still new/expired or already accepted/rejected.
    if (quotation.status !== "quoted") {
      throw new AppError(
        "Only a received quote can be accepted or rejected.",
        400,
      );
    }

    // A customer acceptance moves the request into backend/procurement
    // handling — distinct from the generic "accepted" status admin can also
    // set manually (updateQuotationStatus). "rejected" is unchanged.
    quotation.status = status === "accepted" ? "procurement" : "rejected";
    await quotation.save();

    if (status === "accepted") {
      await generateBookingsFromQuotation(quotation);
      notifyAdmin({
        title: "Quotation accepted by customer",
        message: `${quotation.name} accepted quotation ${quotation.quotationCode} — it has moved to procurement.`,
        quotation: quotation._id,
        createdBy: quotation.user || undefined,
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Quotation ${status}`,
      data: quotation,
    });
  } catch (error) {
    next(error);
  }
};

// ===================== ADMIN =====================

export const listQuotations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search = "",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status && status !== "all") query.status = status;

    if (search) {
      const s = String(search);
      query.$or = [
        { name: { $regex: s, $options: "i" } },
        { mobile: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { company: { $regex: s, $options: "i" } },
        { category: { $regex: s, $options: "i" } },
        { quotationCode: { $regex: s, $options: "i" } },
      ];
    }

    const [quotations, total] = await Promise.all([
      Quotation.find(query)
        .populate("user", "name mobile email")
        .populate("respondedBy", "name email")
        .populate("assignedVendor", "name mobile email business")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Quotation.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: quotations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getQuotation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const quotation = await Quotation.findById(id)
      .populate("user", "name mobile email")
      .populate("respondedBy", "name email")
      .populate("assignedVendor", "name mobile email business");
    if (!quotation) throw new AppError("Quotation not found", 404);
    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
};

// Admin sends back a price / notes
export const respondToQuotation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { quotedPrice, quotedValidTill, adminNotes } = req.body;

    const quotation = await Quotation.findById(id);
    if (!quotation) throw new AppError("Quotation not found", 404);

    // A response to an already-quoted request is a revision, not a first
    // send — the buyer-facing push wording differs accordingly, and the
    // PRIOR quote must be preserved (not silently overwritten) below.
    const isRevision = quotation.status === "quoted";

    if (isRevision) {
      if (!Array.isArray(quotation.quoteHistory)) quotation.quoteHistory = [];
      quotation.quoteHistory.push({
        quotedPrice: quotation.quotedPrice ?? null,
        quotedValidTill: quotation.quotedValidTill ?? null,
        adminNotes: quotation.adminNotes,
        respondedBy: quotation.respondedBy ?? null,
        respondedAt: quotation.respondedAt ?? null,
      });
    }

    if (quotedPrice !== undefined && quotedPrice !== null && quotedPrice !== "") {
      const num = Number(quotedPrice);
      if (!Number.isFinite(num) || num < 0) {
        throw new AppError("Quoted price must be a non-negative number", 400);
      }
      quotation.quotedPrice = num;
    }
    if (quotedValidTill) quotation.quotedValidTill = new Date(quotedValidTill);
    if (adminNotes !== undefined) quotation.adminNotes = adminNotes;
    quotation.status = "quoted";
    quotation.respondedBy = new mongoose.Types.ObjectId(req.admin!._id);
    quotation.respondedAt = new Date();

    await quotation.save();

    // Buyer-facing notification — no in-app inbox exists for customers yet
    // (unlike vendor/driver), so this pushes directly to their device, the
    // same way B1 pushes a driver on dispatch.
    if (quotation.user) {
      User.findById(quotation.user)
        .select("deviceInfo.fcmToken")
        .lean()
        .then((user) => {
          const token = user?.deviceInfo?.fcmToken;
          if (!token) return;
          return sendPush(
            [token],
            isRevision ? "Quotation revised" : "Quotation received",
            `Your bulk quotation ${quotation.quotationCode} has been ${isRevision ? "revised" : "quoted"} — tap to view.`,
            { quotationId: String(quotation._id) },
          );
        })
        .catch(() => {});
    }

    res.json({
      success: true,
      message: "Quotation responded successfully",
      data: quotation,
    });
  } catch (error) {
    next(error);
  }
};

// Admin uploads (or replaces) a PDF document against a quotation
export const uploadQuotationPdf = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file as Express.Multer.File & { location?: string };

    if (!file || !file.location) {
      throw new AppError("Please attach a PDF file", 400);
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) throw new AppError("Quotation not found", 404);

    // This is admin's FORMAL quotation back to the customer — a separate
    // slot from `quotationPdf` (the customer's own RFQ upload from
    // createQuotation). Only remove a previously-uploaded OTG quotation
    // (i.e. a re-upload replacing admin's own prior document), never the
    // customer's file.
    if (quotation.otgQuotationPdf?.url) {
      await deleteFromS3(quotation.otgQuotationPdf.url);
    }

    quotation.otgQuotationPdf = {
      url: file.location,
      name: file.originalname,
      uploadedAt: new Date(),
    };
    await quotation.save();

    res.json({
      success: true,
      message: "Quotation PDF uploaded",
      data: quotation,
    });
  } catch (error) {
    next(error);
  }
};

export const updateQuotationStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = [
      "new",
      "quoted",
      "accepted",
      "procurement",
      "rejected",
      "expired",
    ];
    if (!allowed.includes(status)) {
      throw new AppError("Invalid status", 400);
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) throw new AppError("Quotation not found", 404);

    quotation.status = status;
    if (status === "quoted") {
      quotation.respondedBy = new mongoose.Types.ObjectId(req.admin!._id);
      quotation.respondedAt = new Date();
    }
    await quotation.save();

    if (status === "accepted" || status === "procurement") {
      await generateBookingsFromQuotation(quotation);
    }

    res.json({
      success: true,
      message: `Quotation marked as ${status}`,
      data: quotation,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteQuotation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const quotation = await Quotation.findByIdAndDelete(id);
    if (!quotation) throw new AppError("Quotation not found", 404);
    res.json({ success: true, message: "Quotation deleted" });
  } catch (error) {
    next(error);
  }
};

// Admin assigns (or changes/unassigns) the vendor handling this quotation
export const assignVendorToQuotation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { vendorId, vendorRate } = req.body as {
      vendorId?: string | null;
      vendorRate?: number | string | null;
    };

    const quotation = await Quotation.findById(id);
    if (!quotation) throw new AppError("Quotation not found", 404);

    if (vendorId) {
      const vendor = await Vendor.findOne({
        _id: vendorId,
        isDeleted: false,
        status: "active",
      }).select("_id");
      if (!vendor) {
        throw new AppError("Vendor not found or inactive", 400);
      }

      // Reassigning to a different vendor (or actually changing the rate)
      // resets the PO's own accept state — the vendor must acknowledge the
      // (possibly new) rate again. A no-op re-save (same vendor, same rate)
      // must NOT reset an already-accepted PO back to "pending".
      const isNewAssignment =
        String(quotation.assignedVendor || "") !== String(vendor._id);
      const previousRate = quotation.vendorRate ?? null;

      quotation.assignedVendor = vendor._id as any;
      quotation.assignedAt = new Date();
      quotation.assignedBy = new mongoose.Types.ObjectId(req.admin!._id);

      if (vendorRate !== undefined && vendorRate !== null && vendorRate !== "") {
        const num = Number(vendorRate);
        if (!Number.isFinite(num) || num < 0) {
          throw new AppError("Vendor rate must be a non-negative number", 400);
        }
        quotation.vendorRate = num;
      }

      // `quotation.vendorRate` is a schema field defaulting to `null` — once
      // the document is loaded it's never actually `undefined`, so comparing
      // against `previousRate` (captured before the assignment above) is the
      // only way to detect a genuine change rather than tautologically
      // resetting on every save.
      const rateChanged = (quotation.vendorRate ?? null) !== previousRate;
      if (isNewAssignment || rateChanged) {
        quotation.vendorPoStatus = "pending";
        quotation.vendorPoAcceptedAt = null;
      }
    } else {
      quotation.assignedVendor = null;
      quotation.assignedAt = null;
      quotation.assignedBy = null;
      quotation.vendorRate = null;
      quotation.vendorPoStatus = null;
      quotation.vendorPoAcceptedAt = null;
    }

    await quotation.save();

    const populated = await Quotation.findById(quotation._id)
      .populate("user", "name mobile email")
      .populate("respondedBy", "name email")
      .populate("assignedVendor", "name mobile email business");

    res.json({
      success: true,
      message: vendorId
        ? "Vendor assigned to quotation"
        : "Vendor unassigned from quotation",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// ===================== VENDOR =====================

// Vendor lists quotations assigned to them
// Fields a vendor must NEVER see: the customer's negotiated/quoted price
// (top-level and per-item), quote validity/currency, admin's internal
// notes, and OTG's formal quotation document to the customer (all of these
// either directly contain, or are strong proxies for, the customer-facing
// price/margin — see the access-control requirement in the "vendor must
// never see OTG's quotation/price to customer" spec). Applied via `.select()`
// (a real MongoDB-level exclusion, not a post-hoc field-delete) to every
// vendor-facing quotation read so the confidential data never reaches the
// wire, not just the UI.
const VENDOR_QUOTATION_EXCLUDE =
  "-quotedPrice -items.quotedPrice -quotedCurrency -quotedValidTill -adminNotes -otgQuotationPdf -quoteHistory";

export const listVendorQuotations = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor?.id;
    if (!vendorId) throw new AppError("Authentication required", 401);

    const status = (req.query.status as string) || undefined;
    const query: any = { assignedVendor: vendorId };
    if (status && status !== "all") query.status = status;

    const quotations = await Quotation.find(query)
      .select(VENDOR_QUOTATION_EXCLUDE)
      .populate("user", "name mobile email")
      .sort({ assignedAt: -1, createdAt: -1 })
      .limit(200);

    res.json({ success: true, data: quotations });
  } catch (error) {
    next(error);
  }
};

// Vendor fetches a single assigned quotation
export const getVendorQuotation = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor?.id;
    if (!vendorId) throw new AppError("Authentication required", 401);

    const { id } = req.params;
    const quotation = await Quotation.findOne({
      _id: id,
      assignedVendor: vendorId,
    })
      .select(VENDOR_QUOTATION_EXCLUDE)
      .populate("user", "name mobile email");

    if (!quotation) {
      throw new AppError("Quotation not found or not assigned to you", 404);
    }
    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
};

// Vendor accepts the PO (their own agreed rate) for a quotation assigned to
// them — independent of the customer's own accept/reject of `status`.
export const acceptVendorPo = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor?.id;
    if (!vendorId) throw new AppError("Authentication required", 401);

    const { id } = req.params;
    const quotation = await Quotation.findOne({
      _id: id,
      assignedVendor: vendorId,
    });
    if (!quotation) {
      throw new AppError("Quotation not found or not assigned to you", 404);
    }
    if (quotation.vendorRate == null) {
      throw new AppError("No vendor rate has been set for this PO yet.", 400);
    }

    quotation.vendorPoStatus = "accepted";
    quotation.vendorPoAcceptedAt = new Date();
    await quotation.save();

    // Re-fetch with the same vendor-facing exclusion as list/get above —
    // `quotation` here was loaded WITHOUT that projection (needed the full
    // doc to validate/mutate vendorRate), so it must not be returned as-is.
    const redacted = await Quotation.findById(quotation._id).select(
      VENDOR_QUOTATION_EXCLUDE,
    );

    res.json({
      success: true,
      message: "Purchase order accepted",
      data: redacted,
    });
  } catch (error) {
    next(error);
  }
};

export const quotationCounts = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [newC, quoted, accepted, procurement, rejected, expired] =
      await Promise.all([
        Quotation.countDocuments({ status: "new" }),
        Quotation.countDocuments({ status: "quoted" }),
        Quotation.countDocuments({ status: "accepted" }),
        Quotation.countDocuments({ status: "procurement" }),
        Quotation.countDocuments({ status: "rejected" }),
        Quotation.countDocuments({ status: "expired" }),
      ]);
    res.json({
      success: true,
      data: { new: newC, quoted, accepted, procurement, rejected, expired },
    });
  } catch (error) {
    next(error);
  }
};
