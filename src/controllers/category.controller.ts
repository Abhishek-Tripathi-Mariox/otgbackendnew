import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Category from "../models/Category.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";
import { deleteFromS3 } from "../config/s3";

// Get all categories (with pagination and filters)
export const getCategories = async (
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

    const [categories, total] = await Promise.all([
      Category.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Category.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: categories,
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

// Get single category by ID
export const getCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email");

    if (!category) {
      throw new AppError("Category not found", 404);
    }

    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

// Create category
export const createCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, status = "active" } = req.body;

    if (!name) {
      throw new AppError("Category name is required", 400);
    }

    if (!req.file) {
      throw new AppError("Category image is required", 400);
    }

    // Check if category with same name exists
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isDeleted: false,
    });

    if (existingCategory) {
      // Delete uploaded file if category exists
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Category with this name already exists", 400);
    }

    const category = new Category({
      name,
      status,
      image: (req.file as any).location,
      createdBy: req.admin?._id,
    });

    await category.save();

    const populatedCategory = await Category.findById(category._id).populate(
      "createdBy",
      "name email",
    );

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: populatedCategory,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && (req.file as any).location) {
      await deleteFromS3((req.file as any).location);
    }
    next(error);
  }
};

// Update category
export const updateCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const category = await Category.findOne({ _id: id, isDeleted: false });

    if (!category) {
      // Delete uploaded file if category not found
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Category not found", 404);
    }

    // Check if name is being changed and if it conflicts
    if (name && name !== category.name) {
      const existingCategory = await Category.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
        isDeleted: false,
        _id: { $ne: id },
      });

      if (existingCategory) {
        if (req.file && (req.file as any).location) {
          await deleteFromS3((req.file as any).location);
        }
        throw new AppError("Category with this name already exists", 400);
      }
      category.name = name;
    }

    if (status) {
      category.status = status;
    }

    // Update image if new file uploaded
    if (req.file && (req.file as any).location) {
      // Delete old image from S3
      if (category.image) {
        await deleteFromS3(category.image);
      }
      category.image = (req.file as any).location;
    }

    category.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await category.save();

    const populatedCategory = await Category.findById(category._id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Category updated successfully",
      data: populatedCategory,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete category
export const deleteCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await Category.findOne({ _id: id, isDeleted: false });

    if (!category) {
      throw new AppError("Category not found", 404);
    }

    category.isDeleted = true;
    category.deletedAt = new Date();
    category.deletedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await category.save();

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore deleted category
export const restoreCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await Category.findOne({ _id: id, isDeleted: true });

    if (!category) {
      throw new AppError("Deleted category not found", 404);
    }

    // Check if name conflicts with existing active category
    const existingCategory = await Category.findOne({
      name: category.name,
      isDeleted: false,
    });

    if (existingCategory) {
      throw new AppError(
        "Cannot restore: A category with this name already exists",
        400,
      );
    }

    category.isDeleted = false;
    category.deletedAt = null;
    category.deletedBy = null;
    category.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await category.save();

    const populatedCategory = await Category.findById(category._id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Category restored successfully",
      data: populatedCategory,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete category (hard delete)
export const permanentDeleteCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);

    if (!category) {
      throw new AppError("Category not found", 404);
    }

    // Delete image from S3
    if (category.image) {
      await deleteFromS3(category.image);
    }

    await Category.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Category permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle category status
export const toggleCategoryStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await Category.findOne({ _id: id, isDeleted: false });

    if (!category) {
      throw new AppError("Category not found", 404);
    }

    category.status = category.status === "active" ? "inactive" : "active";
    category.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await category.save();

    res.json({
      success: true,
      message: `Category ${category.status === "active" ? "activated" : "deactivated"} successfully`,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};
