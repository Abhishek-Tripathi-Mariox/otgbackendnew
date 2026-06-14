import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import SubCategory from "../models/SubCategory.model";
import Category from "../models/Category.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";
import { deleteFromS3 } from "../config/s3";

// Get all sub categories (with pagination and filters)
export const getSubCategories = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      category,
      status,
      fromDate,
      toDate,
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

    // Filter by category
    if (category && mongoose.Types.ObjectId.isValid(category as string)) {
      query.category = new mongoose.Types.ObjectId(category as string);
    }

    // Filter by status
    if (status && (status === "active" || status === "inactive")) {
      query.status = status;
    }

    // Filter by date range
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        query.createdAt.$gte = new Date(fromDate as string);
      }
      if (toDate) {
        const endDate = new Date(toDate as string);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    const [subCategories, total] = await Promise.all([
      SubCategory.find(query)
        .populate("category", "name image status")
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      SubCategory.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: subCategories,
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

// Get single sub category by ID
export const getSubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategory = await SubCategory.findById(id)
      .populate("category", "name image status")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email");

    if (!subCategory) {
      throw new AppError("Sub category not found", 404);
    }

    res.json({
      success: true,
      data: subCategory,
    });
  } catch (error) {
    next(error);
  }
};

// Get sub categories by category ID
export const getSubCategoriesByCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw new AppError("Invalid category ID", 400);
    }

    const subCategories = await SubCategory.find({
      category: categoryId,
      isDeleted: false,
      status: "active",
    })
      .populate("category", "name image status")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: subCategories,
    });
  } catch (error) {
    next(error);
  }
};

// Create sub category
export const createSubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, category, status = "active" } = req.body;

    if (!name) {
      throw new AppError("Sub category name is required", 400);
    }

    if (!category) {
      throw new AppError("Category is required", 400);
    }

    if (!req.file) {
      throw new AppError("Sub category image is required", 400);
    }

    // Check if category exists
    const categoryExists = await Category.findOne({
      _id: category,
      isDeleted: false,
    });

    if (!categoryExists) {
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Category not found", 404);
    }

    // Check if sub category with same name exists in the same category
    const existingSubCategory = await SubCategory.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      category,
      isDeleted: false,
    });

    if (existingSubCategory) {
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError(
        "Sub category with this name already exists in this category",
        400,
      );
    }

    const subCategory = new SubCategory({
      name,
      category,
      status,
      image: (req.file as any).location,
      createdBy: req.admin?._id,
    });

    await subCategory.save();

    const populatedSubCategory = await SubCategory.findById(subCategory._id)
      .populate("category", "name image status")
      .populate("createdBy", "name email");

    res.status(201).json({
      success: true,
      message: "Sub category created successfully",
      data: populatedSubCategory,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && (req.file as any).location) {
      await deleteFromS3((req.file as any).location);
    }
    next(error);
  }
};

// Update sub category
export const updateSubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, category, status } = req.body;

    const subCategory = await SubCategory.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!subCategory) {
      if (req.file && (req.file as any).location) {
        await deleteFromS3((req.file as any).location);
      }
      throw new AppError("Sub category not found", 404);
    }

    // If category is being changed, verify it exists
    if (category && category !== subCategory.category.toString()) {
      const categoryExists = await Category.findOne({
        _id: category,
        isDeleted: false,
      });

      if (!categoryExists) {
        if (req.file && (req.file as any).location) {
          await deleteFromS3((req.file as any).location);
        }
        throw new AppError("Category not found", 404);
      }
      subCategory.category = category;
    }

    // Check if name is being changed and if it conflicts
    if (name && name !== subCategory.name) {
      const existingSubCategory = await SubCategory.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
        category: subCategory.category,
        isDeleted: false,
        _id: { $ne: id },
      });

      if (existingSubCategory) {
        if (req.file && (req.file as any).location) {
          await deleteFromS3((req.file as any).location);
        }
        throw new AppError(
          "Sub category with this name already exists in this category",
          400,
        );
      }
      subCategory.name = name;
    }

    if (status) {
      subCategory.status = status;
    }

    // Update image if new file uploaded
    if (req.file && (req.file as any).location) {
      // Delete old image from S3
      if (subCategory.image) {
        await deleteFromS3(subCategory.image);
      }
      subCategory.image = (req.file as any).location;
    }

    subCategory.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await subCategory.save();

    const populatedSubCategory = await SubCategory.findById(subCategory._id)
      .populate("category", "name image status")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Sub category updated successfully",
      data: populatedSubCategory,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete sub category
export const deleteSubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategory = await SubCategory.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!subCategory) {
      throw new AppError("Sub category not found", 404);
    }

    subCategory.isDeleted = true;
    subCategory.deletedAt = new Date();
    subCategory.deletedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await subCategory.save();

    res.json({
      success: true,
      message: "Sub category deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore deleted sub category
export const restoreSubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategory = await SubCategory.findOne({ _id: id, isDeleted: true });

    if (!subCategory) {
      throw new AppError("Deleted sub category not found", 404);
    }

    // Check if name conflicts with existing active sub category in same category
    const existingSubCategory = await SubCategory.findOne({
      name: subCategory.name,
      category: subCategory.category,
      isDeleted: false,
    });

    if (existingSubCategory) {
      throw new AppError(
        "Cannot restore: A sub category with this name already exists in this category",
        400,
      );
    }

    subCategory.isDeleted = false;
    subCategory.deletedAt = null;
    subCategory.deletedBy = null;
    subCategory.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await subCategory.save();

    const populatedSubCategory = await SubCategory.findById(subCategory._id)
      .populate("category", "name image status")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Sub category restored successfully",
      data: populatedSubCategory,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete sub category (hard delete)
export const permanentDeleteSubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategory = await SubCategory.findById(id);

    if (!subCategory) {
      throw new AppError("Sub category not found", 404);
    }

    // Delete image from S3
    if (subCategory.image) {
      await deleteFromS3(subCategory.image);
    }

    await SubCategory.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Sub category permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle sub category status
export const toggleSubCategoryStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategory = await SubCategory.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!subCategory) {
      throw new AppError("Sub category not found", 404);
    }

    subCategory.status =
      subCategory.status === "active" ? "inactive" : "active";
    subCategory.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await subCategory.save();

    res.json({
      success: true,
      message: `Sub category ${subCategory.status === "active" ? "activated" : "deactivated"} successfully`,
      data: subCategory,
    });
  } catch (error) {
    next(error);
  }
};
