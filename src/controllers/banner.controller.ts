import { Response, NextFunction } from "express";
import Banner from "../models/Banner.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";
import { deleteFromS3 } from "../config/s3";

// Get all banners (with pagination and filters)
export const getBanners = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status,
      showDeleted = "false",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};

    if (showDeleted === "true") {
      query.isDeleted = true;
    } else {
      query.isDeleted = false;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
      ];
    }

    if (status && (status === "active" || status === "inactive")) {
      query.status = status;
    }

    const [banners, total] = await Promise.all([
      Banner.find(query)
        .populate("createdBy", "name email")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Banner.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: banners,
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

// Get single banner
export const getBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const banner = await Banner.findById(id).populate(
      "createdBy",
      "name email",
    );

    if (!banner) {
      throw new AppError("Banner not found", 404);
    }

    res.json({
      success: true,
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

// Create banner
export const createBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { title, content, enableBulkQuote = "true", status = "active" } = req.body;

    if (!req.file) {
      throw new AppError("Banner image is required", 400);
    }

    // Get next order number
    const lastBanner = await Banner.findOne({ isDeleted: false }).sort({
      order: -1,
    });
    const order = lastBanner ? lastBanner.order + 1 : 0;

    const banner = new Banner({
      title,
      content,
      enableBulkQuote: enableBulkQuote === "true" || enableBulkQuote === true,
      image: (req.file as any).location,
      order,
      status,
      createdBy: req.admin?._id,
    });

    await banner.save();

    const populatedBanner = await Banner.findById(banner._id).populate(
      "createdBy",
      "name email",
    );

    res.status(201).json({
      success: true,
      message: "Banner created successfully",
      data: populatedBanner,
    });
  } catch (error) {
    if (req.file && (req.file as any).location) {
      await deleteFromS3((req.file as any).location);
    }
    next(error);
  }
};

// Update banner
export const updateBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, content, enableBulkQuote, status } = req.body;

    const banner = await Banner.findOne({ _id: id, isDeleted: false });

    if (!banner) {
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Banner not found", 404);
    }

    if (title !== undefined) banner.title = title;
    if (content !== undefined) banner.content = content;
    if (enableBulkQuote !== undefined) {
      banner.enableBulkQuote =
        enableBulkQuote === "true" || enableBulkQuote === true;
    }
    if (status) banner.status = status;

    // Update image if new file uploaded
    if (req.file && (req.file as any).location) {
      if (banner.image) {
        await deleteFromS3(banner.image);
      }
      banner.image = (req.file as any).location;
    }

    await banner.save();

    const populatedBanner = await Banner.findById(banner._id).populate(
      "createdBy",
      "name email",
    );

    res.json({
      success: true,
      message: "Banner updated successfully",
      data: populatedBanner,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete banner
export const deleteBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const banner = await Banner.findOne({ _id: id, isDeleted: false });

    if (!banner) {
      throw new AppError("Banner not found", 404);
    }

    banner.isDeleted = true;
    await banner.save();

    res.json({
      success: true,
      message: "Banner deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore deleted banner
export const restoreBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const banner = await Banner.findOne({ _id: id, isDeleted: true });

    if (!banner) {
      throw new AppError("Deleted banner not found", 404);
    }

    banner.isDeleted = false;
    await banner.save();

    res.json({
      success: true,
      message: "Banner restored successfully",
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete banner
export const permanentDeleteBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const banner = await Banner.findById(id);

    if (!banner) {
      throw new AppError("Banner not found", 404);
    }

    // Delete image from S3
    if (banner.image) {
      await deleteFromS3(banner.image);
    }

    await Banner.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Banner permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle banner status
export const toggleBannerStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const banner = await Banner.findOne({ _id: id, isDeleted: false });

    if (!banner) {
      throw new AppError("Banner not found", 404);
    }

    banner.status = banner.status === "active" ? "inactive" : "active";
    await banner.save();

    res.json({
      success: true,
      message: `Banner ${banner.status === "active" ? "activated" : "deactivated"} successfully`,
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

// Reorder banners
export const reorderBanners = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new AppError("orderedIds array is required", 400);
    }

    const updates = orderedIds.map((id: string, index: number) =>
      Banner.findByIdAndUpdate(id, { order: index }),
    );

    await Promise.all(updates);

    res.json({
      success: true,
      message: "Banners reordered successfully",
    });
  } catch (error) {
    next(error);
  }
};
