import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Quotation from "../models/Quotation.model";
import Vendor from "../models/Vendor.model";
import { AuthRequest } from "../types";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { VendorRequest } from "../middlewares/vendorAuth.middleware";
import { AppError } from "../middlewares/errorHandler";

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

    let cleanedItems: any[] = [];
    if (Array.isArray(items) && items.length > 0) {
      cleanedItems = items
        .map(sanitizeItem)
        .filter((i) => i !== null) as any[];
      if (cleanedItems.length === 0) {
        throw new AppError("Please add at least one item", 400);
      }
    }

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
      status: "new",
    });

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

    quotation.status = status;
    await quotation.save();

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

    res.json({
      success: true,
      message: "Quotation responded successfully",
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

    const allowed = ["new", "quoted", "accepted", "rejected", "expired"];
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
    const { vendorId } = req.body as { vendorId?: string | null };

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
      quotation.assignedVendor = vendor._id as any;
      quotation.assignedAt = new Date();
      quotation.assignedBy = new mongoose.Types.ObjectId(req.admin!._id);
    } else {
      quotation.assignedVendor = null;
      quotation.assignedAt = null;
      quotation.assignedBy = null;
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
    }).populate("user", "name mobile email");

    if (!quotation) {
      throw new AppError("Quotation not found or not assigned to you", 404);
    }
    res.json({ success: true, data: quotation });
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
    const [newC, quoted, accepted, rejected, expired] = await Promise.all([
      Quotation.countDocuments({ status: "new" }),
      Quotation.countDocuments({ status: "quoted" }),
      Quotation.countDocuments({ status: "accepted" }),
      Quotation.countDocuments({ status: "rejected" }),
      Quotation.countDocuments({ status: "expired" }),
    ]);
    res.json({
      success: true,
      data: { new: newC, quoted, accepted, rejected, expired },
    });
  } catch (error) {
    next(error);
  }
};
