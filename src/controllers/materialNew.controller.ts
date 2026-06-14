import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Material from "../models/Material.model";
import Category from "../models/Category.model";
import SubCategory from "../models/SubCategory.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";
import { deleteFromS3 } from "../config/s3";

// Get all materials (with pagination and filters)
export const getMaterials = async (
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
      subCategory,
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

    // Search by name or specs
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { specs: { $regex: search, $options: "i" } },
        { brand: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by category
    if (category && mongoose.Types.ObjectId.isValid(category as string)) {
      query.category = new mongoose.Types.ObjectId(category as string);
    }

    // Filter by sub-category
    if (subCategory && mongoose.Types.ObjectId.isValid(subCategory as string)) {
      query.subCategory = new mongoose.Types.ObjectId(subCategory as string);
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

    const [materials, total] = await Promise.all([
      Material.find(query)
        .populate("category", "name image status")
        .populate("subCategory", "name image status")
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Material.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: materials,
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

// Get single material by ID
export const getMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findById(id)
      .populate("category", "name image status")
      .populate("subCategory", "name image status")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email");

    if (!material) {
      throw new AppError("Material not found", 404);
    }

    res.json({
      success: true,
      data: material,
    });
  } catch (error) {
    next(error);
  }
};

// Get materials by category
export const getMaterialsByCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw new AppError("Invalid category ID", 400);
    }

    const materials = await Material.find({
      category: categoryId,
      isDeleted: false,
      status: "active",
    })
      .populate("category", "name image status")
      .populate("subCategory", "name image status")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: materials,
    });
  } catch (error) {
    next(error);
  }
};

// Get materials by sub-category
export const getMaterialsBySubCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { subCategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
      throw new AppError("Invalid sub-category ID", 400);
    }

    const materials = await Material.find({
      subCategory: subCategoryId,
      isDeleted: false,
      status: "active",
    })
      .populate("category", "name image status")
      .populate("subCategory", "name image status")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: materials,
    });
  } catch (error) {
    next(error);
  }
};

// Create material
export const createMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      name,
      description,
      specs,
      brand,
      category,
      subCategory,
      unit,
      minOrderQty,
      diameter,
      basicPrice,
      mrp,
      sellingPrice,
      gst,
      transportation,
      requestQuote,
      status = "active",
    } = req.body;

    const isRequestQuote = requestQuote === "true" || requestQuote === true;

    if (!name) {
      throw new AppError("Material name is required", 400);
    }

    if (!category) {
      throw new AppError("Category is required", 400);
    }

    if (!unit) {
      throw new AppError("Unit is required", 400);
    }

    if (!isRequestQuote && !basicPrice) {
      throw new AppError("Basic price is required when not using Request a Quote", 400);
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      throw new AppError("At least one material image is required", 400);
    }

    const imageLocations = files.map((f: any) => f.location);

    // Check if category exists
    const categoryExists = await Category.findOne({
      _id: category,
      isDeleted: false,
    });

    if (!categoryExists) {
      for (const loc of imageLocations) {
        await deleteFromS3(loc);
      }
      throw new AppError("Category not found", 404);
    }

    // If subCategory is provided, verify it exists and belongs to the category
    if (subCategory) {
      const subCategoryExists = await SubCategory.findOne({
        _id: subCategory,
        category: category,
        isDeleted: false,
      });

      if (!subCategoryExists) {
        for (const loc of imageLocations) {
          await deleteFromS3(loc);
        }
        throw new AppError(
          "Sub-category not found or does not belong to the selected category",
          404,
        );
      }
    }

    // Handle transportation from both JSON body and FormData bracket notation
    const transportationType =
      transportation?.type ||
      (req.body as any)["transportation[type]"] ||
      "free";
    const transportationCharge =
      transportation?.charge ||
      (req.body as any)["transportation[charge]"] ||
      0;

    const material = new Material({
      name,
      description,
      specs,
      brand,
      category,
      subCategory: subCategory || null,
      unit,
      minOrderQty: minOrderQty ? parseInt(minOrderQty) : 1,
      diameter: diameter || undefined,
      requestQuote: isRequestQuote,
      basicPrice: isRequestQuote ? 0 : (basicPrice ? parseFloat(basicPrice) : 0),
      mrp: isRequestQuote ? 0 : (mrp ? parseFloat(mrp) : 0),
      sellingPrice: isRequestQuote ? 0 : (sellingPrice ? parseFloat(sellingPrice) : 0),
      finalSellingPrice: isRequestQuote ? 0 : (req.body.finalSellingPrice ? parseFloat(req.body.finalSellingPrice) : 0),
      gst: isRequestQuote ? 0 : (gst ? parseFloat(gst) : 0),
      transportation: {
        type: transportationType,
        charge: transportationCharge ? parseFloat(transportationCharge) : 0,
      },
      status,
      images: imageLocations,
      createdBy: req.admin?._id,
    });

    await material.save();

    const populatedMaterial = await Material.findById(material._id)
      .populate("category", "name image status")
      .populate("subCategory", "name image status")
      .populate("createdBy", "name email");

    res.status(201).json({
      success: true,
      message: "Material created successfully",
      data: populatedMaterial,
    });
  } catch (error) {
    // Clean up uploaded files on error
    const files = req.files as Express.Multer.File[] | undefined;
    if (files && files.length > 0) {
      for (const f of files) {
        if ((f as any).location) {
          await deleteFromS3((f as any).location);
        }
      }
    }
    next(error);
  }
};

// Update material
export const updateMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      specs,
      brand,
      category,
      subCategory,
      unit,
      minOrderQty,
      diameter,
      basicPrice,
      mrp,
      sellingPrice,
      gst,
      transportation,
      status,
    } = req.body;

    const material = await Material.findOne({ _id: id, isDeleted: false });

    if (!material) {
      const files = req.files as Express.Multer.File[] | undefined;
      if (files && files.length > 0) {
        for (const f of files) {
          if ((f as any).location) await deleteFromS3((f as any).location);
        }
      }
      throw new AppError("Material not found", 404);
    }

    // If category is being changed, verify it exists
    if (category && category !== material.category.toString()) {
      const categoryExists = await Category.findOne({
        _id: category,
        isDeleted: false,
      });

      if (!categoryExists) {
        const files = req.files as Express.Multer.File[] | undefined;
        if (files && files.length > 0) {
          for (const f of files) {
            if ((f as any).location) await deleteFromS3((f as any).location);
          }
        }
        throw new AppError("Category not found", 404);
      }
      material.category = category;
      // Reset subCategory when category changes
      material.subCategory = null;
    }

    // If subCategory is provided, verify it exists and belongs to the category
    if (subCategory !== undefined) {
      if (subCategory) {
        const subCategoryExists = await SubCategory.findOne({
          _id: subCategory,
          category: material.category,
          isDeleted: false,
        });

        if (!subCategoryExists) {
          const files = req.files as Express.Multer.File[] | undefined;
          if (files && files.length > 0) {
            for (const f of files) {
              if ((f as any).location) await deleteFromS3((f as any).location);
            }
          }
          throw new AppError(
            "Sub-category not found or does not belong to the selected category",
            404,
          );
        }
        material.subCategory = subCategory;
      } else {
        material.subCategory = null;
      }
    }

    if (name) {
      material.name = name;
    }

    if (description !== undefined) {
      material.description = description;
    }

    if (specs !== undefined) {
      material.specs = specs;
    }

    if (brand !== undefined) {
      material.brand = brand;
    }

    if (unit) {
      material.unit = unit;
    }

    if (minOrderQty !== undefined) {
      material.minOrderQty = parseInt(minOrderQty) || 1;
    }

    if (diameter !== undefined) {
      material.diameter = diameter || undefined;
    }

    if (req.body.requestQuote !== undefined) {
      material.requestQuote = req.body.requestQuote === "true" || req.body.requestQuote === true;
    }

    if (basicPrice !== undefined) {
      material.basicPrice = parseFloat(basicPrice);
    }

    if (mrp !== undefined) {
      material.mrp = parseFloat(mrp);
    }

    if (sellingPrice !== undefined) {
      material.sellingPrice = parseFloat(sellingPrice);
    }

    if (req.body.finalSellingPrice !== undefined) {
      material.finalSellingPrice = parseFloat(req.body.finalSellingPrice);
    }

    if (gst !== undefined) {
      material.gst = parseFloat(gst);
    }

    // Handle transportation from both JSON body and FormData bracket notation
    const updTransType =
      transportation?.type || (req.body as any)["transportation[type]"];
    const updTransCharge =
      transportation?.charge ?? (req.body as any)["transportation[charge]"];

    if (updTransType || updTransCharge !== undefined) {
      material.transportation = {
        type: updTransType || material.transportation?.type || "free",
        charge:
          updTransCharge !== undefined && updTransCharge !== null
            ? parseFloat(updTransCharge)
            : material.transportation?.charge || 0,
      };
    }

    if (status) {
      material.status = status;
    }

    // Handle images: new uploads + existing images to keep
    const files = req.files as Express.Multer.File[] | undefined;
    const newImageLocations = files ? files.map((f: any) => f.location) : [];

    // existingImages is sent from frontend as a JSON array of URLs to keep
    let existingImages: string[] = [];
    if (req.body.existingImages) {
      try {
        existingImages = JSON.parse(req.body.existingImages);
      } catch {
        existingImages = Array.isArray(req.body.existingImages)
          ? req.body.existingImages
          : [req.body.existingImages];
      }
    }

    const combinedImages = [...existingImages, ...newImageLocations];

    if (combinedImages.length === 0) {
      // Must keep at least 1 image
      throw new AppError("At least one material image is required", 400);
    }

    // Delete removed images from S3
    const removedImages = (material.images || []).filter(
      (img: string) => !existingImages.includes(img)
    );
    for (const img of removedImages) {
      await deleteFromS3(img);
    }

    material.images = combinedImages;

    material.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await material.save();

    const populatedMaterial = await Material.findById(material._id)
      .populate("category", "name image status")
      .populate("subCategory", "name image status")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Material updated successfully",
      data: populatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete material
export const deleteMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findOne({ _id: id, isDeleted: false });

    if (!material) {
      throw new AppError("Material not found", 404);
    }

    material.isDeleted = true;
    material.deletedAt = new Date();
    material.deletedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await material.save();

    res.json({
      success: true,
      message: "Material deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore deleted material
export const restoreMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findOne({ _id: id, isDeleted: true });

    if (!material) {
      throw new AppError("Deleted material not found", 404);
    }

    material.isDeleted = false;
    material.deletedAt = null;
    material.deletedBy = null;
    material.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await material.save();

    const populatedMaterial = await Material.findById(material._id)
      .populate("category", "name image status")
      .populate("subCategory", "name image status")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Material restored successfully",
      data: populatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete material (hard delete)
export const permanentDeleteMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findById(id);

    if (!material) {
      throw new AppError("Material not found", 404);
    }

    // Delete all images from S3
    if (material.images && material.images.length > 0) {
      for (const img of material.images) {
        await deleteFromS3(img);
      }
    }

    await Material.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Material permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle material status
export const toggleMaterialStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findOne({ _id: id, isDeleted: false });

    if (!material) {
      throw new AppError("Material not found", 404);
    }

    material.status = material.status === "active" ? "inactive" : "active";
    material.updatedBy = req.admin?._id
      ? new mongoose.Types.ObjectId(req.admin._id)
      : null;
    await material.save();

    res.json({
      success: true,
      message: `Material ${material.status === "active" ? "activated" : "deactivated"} successfully`,
      data: material,
    });
  } catch (error) {
    next(error);
  }
};

// Get units list (static list for now)
export const getUnits = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const units = [
      "Pieces",
      "Kg",
      "Gram",
      "Meter",
      "Feet",
      "Inch",
      "Sq. Meter",
      "Sq. Feet",
      "Cu. Meter",
      "Cu. Feet",
      "Litre",
      "Gallon",
      "Bag",
      "Bundle",
      "Roll",
      "Box",
      "Packet",
      "Set",
      "Pair",
      "Dozen",
      "Quintal",
      "M.T. (Metric Ton)",
      "Ton",
      "Running Meter",
      "Running Feet",
    ];

    res.json({
      success: true,
      data: units,
    });
  } catch (error) {
    next(error);
  }
};
