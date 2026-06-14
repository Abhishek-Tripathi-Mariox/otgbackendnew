import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Brand from "../models/Brand.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";
import { deleteFromS3 } from "../config/s3";

// Get all brands (with pagination and filters)
export const getBrands = async (
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

    // Build query
    const query: any = {};

    // Show deleted or not deleted based on query param
    if (showDeleted === "true") {
      query.isDeleted = true;
    } else {
      query.isDeleted = false;
    }

    // Search by name
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    // Filter by status
    if (status && (status === "active" || status === "inactive")) {
      query.status = status;
    }

    const [brands, total] = await Promise.all([
      Brand.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Brand.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: brands,
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

// Get single brand by ID
export const getBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const brand = await Brand.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email");

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    res.json({
      success: true,
      data: brand,
    });
  } catch (error) {
    next(error);
  }
};

// Create brand
export const createBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, status = "active" } = req.body;

    if (!name) {
      throw new AppError("Brand name is required", 400);
    }

    if (!req.file) {
      throw new AppError("Brand image is required", 400);
    }

    // Check if brand with same name exists
    const existingBrand = await Brand.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isDeleted: false,
    });

    if (existingBrand) {
      // Delete uploaded file if brand exists
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Brand with this name already exists", 400);
    }

    const brand = new Brand({
      name,
      status,
      image: (req.file as any).location,
      createdBy: req.admin?._id,
    });

    await brand.save();

    const populatedBrand = await Brand.findById(brand._id).populate(
      "createdBy",
      "name email",
    );

    res.status(201).json({
      success: true,
      message: "Brand created successfully",
      data: populatedBrand,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && (req.file as any).location) {
      await deleteFromS3((req.file as any).location);
    }
    next(error);
  }
};

// Update brand
export const updateBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const brand = await Brand.findOne({ _id: id, isDeleted: false });

    if (!brand) {
      // Delete uploaded file if brand not found
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Brand not found", 404);
    }

    // Check if name is being changed and if it conflicts
    if (name && name !== brand.name) {
      const existingBrand = await Brand.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
        isDeleted: false,
        _id: { $ne: id },
      });

      if (existingBrand) {
        if (req.file && (req.file as any).location) {
          await deleteFromS3((req.file as any).location);
        }
        throw new AppError("Brand with this name already exists", 400);
      }
      brand.name = name;
    }

    if (status) {
      brand.status = status;
    }

    // Update image if new file uploaded
    if (req.file && (req.file as any).location) {
      // Delete old image from S3
      if (brand.image) {
        await deleteFromS3(brand.image);
      }
      brand.image = (req.file as any).location;
    }

    brand.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await brand.save();

    const populatedBrand = await Brand.findById(brand._id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Brand updated successfully",
      data: populatedBrand,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete brand
export const deleteBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const brand = await Brand.findOne({ _id: id, isDeleted: false });

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    brand.isDeleted = true;
    brand.deletedAt = new Date();
    brand.deletedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await brand.save();

    res.json({
      success: true,
      message: "Brand deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore deleted brand
export const restoreBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const brand = await Brand.findOne({ _id: id, isDeleted: true });

    if (!brand) {
      throw new AppError("Deleted brand not found", 404);
    }

    // Check if name conflicts with existing active brand
    const existingBrand = await Brand.findOne({
      name: brand.name,
      isDeleted: false,
    });

    if (existingBrand) {
      throw new AppError(
        "Cannot restore: A brand with this name already exists",
        400,
      );
    }

    brand.isDeleted = false;
    brand.deletedAt = null;
    brand.deletedBy = null;
    brand.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await brand.save();

    const populatedBrand = await Brand.findById(brand._id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Brand restored successfully",
      data: populatedBrand,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete brand (hard delete)
export const permanentDeleteBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const brand = await Brand.findById(id);

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    // Delete image from S3
    if (brand.image) {
      await deleteFromS3(brand.image);
    }

    await Brand.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Brand permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle brand status
export const toggleBrandStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const brand = await Brand.findOne({ _id: id, isDeleted: false });

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    brand.status = brand.status === "active" ? "inactive" : "active";
    brand.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await brand.save();

    res.json({
      success: true,
      message: `Brand ${brand.status === "active" ? "activated" : "deactivated"} successfully`,
      data: brand,
    });
  } catch (error) {
    next(error);
  }
};
