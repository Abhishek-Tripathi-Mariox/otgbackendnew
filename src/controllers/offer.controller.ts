import { Response, NextFunction } from "express";
import Offer from "../models/Offer.model";
import OfferRedemption from "../models/OfferRedemption.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

const SCOPES = ["all", "category", "subCategory", "material", "user"] as const;
const DISCOUNT_TYPES = [
  "percentage",
  "flat",
  "free_delivery",
  "bogo",
] as const;

const normalizeArray = (v: any): any[] => (Array.isArray(v) ? v : []);

/**
 * GET /api/offers — list with optional ?status, ?search, pagination
 */
export const listOffers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      search = "",
      scope,
      discountType,
    } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status === "active" || status === "inactive") query.status = status;
    if (scope) query.scope = scope;
    if (discountType) query.discountType = discountType;
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const [offers, total] = await Promise.all([
      Offer.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("categories", "name")
        .populate("subCategories", "name")
        .populate("materials", "name")
        .populate("users", "name mobile"),
      Offer.countDocuments(query),
    ]);

    const now = new Date();
    const stats = await Offer.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          inactive: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          totalRedemptions: { $sum: "$usageCount" },
        },
      },
    ]);

    res.json({
      success: true,
      data: offers,
      stats: stats[0] || { total: 0, active: 0, inactive: 0, totalRedemptions: 0 },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      meta: { scopes: SCOPES, discountTypes: DISCOUNT_TYPES, now },
    });
  } catch (error) {
    next(error);
  }
};

export const getOffer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate("categories", "name")
      .populate("subCategories", "name")
      .populate("materials", "name")
      .populate("users", "name mobile");
    if (!offer) throw new AppError("Offer not found.", 404);
    res.json({ success: true, data: offer });
  } catch (error) {
    next(error);
  }
};

const validatePayload = (body: any): void => {
  if (!body.code || !String(body.code).trim()) {
    throw new AppError("Coupon code is required.", 400);
  }
  if (!body.title || !String(body.title).trim()) {
    throw new AppError("Title is required.", 400);
  }
  if (!SCOPES.includes(body.scope)) {
    throw new AppError("Invalid scope.", 400);
  }
  if (!DISCOUNT_TYPES.includes(body.discountType)) {
    throw new AppError("Invalid discount type.", 400);
  }
  if (body.discountType === "percentage") {
    if (body.discountValue <= 0 || body.discountValue > 100) {
      throw new AppError("Percentage must be between 1 and 100.", 400);
    }
  }
  if (body.discountType === "flat" && body.discountValue <= 0) {
    throw new AppError("Flat discount must be greater than 0.", 400);
  }
  if (body.discountType === "bogo") {
    if (!body.buyX || body.buyX < 1) {
      throw new AppError("BOGO requires Buy X ≥ 1.", 400);
    }
    if (!body.getY || body.getY < 1) {
      throw new AppError("BOGO requires Get Y ≥ 1.", 400);
    }
  }
  if (body.scope === "category" && (body.categories || []).length === 0) {
    throw new AppError("Pick at least one category.", 400);
  }
  if (body.scope === "subCategory" && (body.subCategories || []).length === 0) {
    throw new AppError("Pick at least one sub-category.", 400);
  }
  if (body.scope === "material" && (body.materials || []).length === 0) {
    throw new AppError("Pick at least one material.", 400);
  }
  if (body.scope === "user" && (body.users || []).length === 0) {
    throw new AppError("Pick at least one user.", 400);
  }
};

const sanitize = (body: any) => ({
  code: String(body.code).toUpperCase().trim(),
  title: String(body.title).trim(),
  description: body.description ? String(body.description).trim() : "",
  scope: body.scope,
  categories: body.scope === "category" ? normalizeArray(body.categories) : [],
  subCategories:
    body.scope === "subCategory" ? normalizeArray(body.subCategories) : [],
  materials: body.scope === "material" ? normalizeArray(body.materials) : [],
  users: body.scope === "user" ? normalizeArray(body.users) : [],
  discountType: body.discountType,
  discountValue: Number(body.discountValue) || 0,
  maxDiscount:
    body.maxDiscount !== "" && body.maxDiscount !== undefined
      ? Number(body.maxDiscount)
      : null,
  buyX: body.discountType === "bogo" ? Number(body.buyX) || 1 : null,
  getY: body.discountType === "bogo" ? Number(body.getY) || 1 : null,
  startsAt: body.startsAt ? new Date(body.startsAt) : null,
  endsAt: body.endsAt ? new Date(body.endsAt) : null,
  minOrderAmount:
    body.minOrderAmount !== "" && body.minOrderAmount !== undefined
      ? Number(body.minOrderAmount)
      : null,
  maxUsesPerUser:
    body.maxUsesPerUser !== "" && body.maxUsesPerUser !== undefined
      ? Number(body.maxUsesPerUser)
      : null,
  globalUsageLimit:
    body.globalUsageLimit !== "" && body.globalUsageLimit !== undefined
      ? Number(body.globalUsageLimit)
      : null,
  autoApply: !!body.autoApply,
  stackable: !!body.stackable,
  status: body.status === "inactive" ? "inactive" : "active",
});

export const createOffer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    validatePayload(req.body);
    const data = sanitize(req.body);

    const dup = await Offer.findOne({ code: data.code });
    if (dup) throw new AppError("A coupon with this code already exists.", 400);

    const offer = await Offer.create({
      ...data,
      createdBy: req.admin?._id,
    });

    res.status(201).json({
      success: true,
      message: "Offer created.",
      data: offer,
    });
  } catch (error) {
    next(error);
  }
};

export const updateOffer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) throw new AppError("Offer not found.", 404);

    validatePayload(req.body);
    const data = sanitize(req.body);

    if (data.code !== offer.code) {
      const dup = await Offer.findOne({
        code: data.code,
        _id: { $ne: offer._id },
      });
      if (dup) throw new AppError("A coupon with this code already exists.", 400);
    }

    Object.assign(offer, data);
    await offer.save();

    res.json({ success: true, message: "Offer updated.", data: offer });
  } catch (error) {
    next(error);
  }
};

export const toggleOfferStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) throw new AppError("Offer not found.", 404);
    offer.status = offer.status === "active" ? "inactive" : "active";
    await offer.save();
    res.json({
      success: true,
      message: `Offer ${offer.status}.`,
      data: offer,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteOffer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) throw new AppError("Offer not found.", 404);
    await offer.deleteOne();
    res.json({ success: true, message: "Offer deleted." });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/offers/:id/redemptions — admin view of who used a coupon.
 */
export const listRedemptions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const redemptions = await OfferRedemption.find({ offer: req.params.id })
      .populate("user", "name mobile email")
      .populate("booking", "bookingId totalAmount")
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ success: true, data: redemptions });
  } catch (error) {
    next(error);
  }
};
