import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Review from "../models/Review.model";
import Material from "../models/Material.model";
import Booking from "../models/Booking.model";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { AppError } from "../middlewares/errorHandler";

// Build {average, total, histogram:{1..5}} for a material from its reviews.
const computeStats = async (materialId: mongoose.Types.ObjectId) => {
  const grouped = await Review.aggregate([
    { $match: { material: materialId, isDeleted: false } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);

  const histogram: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  let total = 0;
  let weighted = 0;
  for (const row of grouped) {
    const star = String(row._id);
    if (histogram[star] !== undefined) {
      histogram[star] = row.count;
      total += row.count;
      weighted += row.count * row._id;
    }
  }
  const average = total > 0 ? Math.round((weighted / total) * 10) / 10 : 0;
  return { average, total, histogram };
};

// GET /api/mobile/catalog/materials/:id/reviews
// Public — returns the material's reviews plus aggregate rating stats.
export const getMaterialReviews = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid material id", 400);
    }
    const materialId = new mongoose.Types.ObjectId(id);

    const [reviews, stats] = await Promise.all([
      Review.find({ material: materialId, isDeleted: false })
        .populate("user", "name")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      computeStats(materialId),
    ]);

    const data = reviews.map((r: any) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment || "",
      name: r.user?.name || "Anonymous",
      reply: r.reply?.text
        ? { text: r.reply.text, repliedAt: r.reply.repliedAt }
        : null,
      createdAt: r.createdAt,
    }));

    res.json({ success: true, data, stats });
  } catch (error) {
    next(error);
  }
};

// POST /api/mobile/catalog/materials/:id/reviews
// Auth — a user who has ordered (and not cancelled) the material can leave or
// update their rating/comment. One review per user per material (upsert).
export const createMaterialReview = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid material id", 400);
    }

    const { rating, comment } = req.body || {};
    const ratingNum = Number(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      throw new AppError("Rating must be between 1 and 5", 400);
    }

    const material = await Material.findOne({ _id: id, isDeleted: false });
    if (!material) throw new AppError("Material not found", 404);

    // Only buyers who actually received/placed an order for this material may
    // review it — mirrors the gating already done on the app side.
    const hasOrdered = await Booking.exists({
      user: new mongoose.Types.ObjectId(userId),
      material: new mongoose.Types.ObjectId(id),
      status: { $ne: "cancelled" },
      isDeleted: false,
    });
    if (!hasOrdered) {
      throw new AppError(
        "You can review this product only after ordering it.",
        403,
      );
    }

    const review = await Review.findOneAndUpdate(
      { material: id, user: userId },
      {
        material: id,
        user: userId,
        rating: ratingNum,
        comment: (comment || "").toString().trim() || undefined,
        isDeleted: false,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const stats = await computeStats(new mongoose.Types.ObjectId(id));

    res.status(201).json({
      success: true,
      message: "Thanks for your feedback!",
      data: {
        _id: review._id,
        rating: review.rating,
        comment: review.comment || "",
        createdAt: review.createdAt,
      },
      stats,
    });
  } catch (error) {
    next(error);
  }
};

// ===== Admin moderation =====

// GET /api/reviews?rating=&search=&materialId=&page=&limit=
export const adminListReviews = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { rating, materialId, search, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const query: any = { isDeleted: false };
    if (rating) query.rating = parseInt(rating as string, 10);
    if (materialId && mongoose.isValidObjectId(materialId as string)) {
      query.material = materialId;
    }
    if (search) {
      query.comment = { $regex: search as string, $options: "i" };
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate("material", "name images")
        .populate("user", "name mobile")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: reviews,
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

// PATCH /api/reviews/:id/reply  body: { text }
export const adminReplyReview = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { text } = req.body || {};
    if (!text || !text.toString().trim()) {
      throw new AppError("Reply text is required", 400);
    }

    const review = await Review.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { reply: { text: text.toString().trim(), repliedAt: new Date() } },
      { new: true },
    )
      .populate("material", "name images")
      .populate("user", "name mobile");

    if (!review) throw new AppError("Review not found", 404);

    res.json({ success: true, message: "Reply posted", data: review });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/reviews/:id  (soft delete)
export const adminDeleteReview = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const review = await Review.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isDeleted: true },
      { new: true },
    );
    if (!review) throw new AppError("Review not found", 404);
    res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    next(error);
  }
};
