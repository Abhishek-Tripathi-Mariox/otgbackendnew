import { Request, Response, NextFunction } from "express";
import Material from "../models/Material.model";
import Category from "../models/Category.model";
import SubCategory from "../models/SubCategory.model";
import Vendor from "../models/Vendor.model";
import { AppError } from "../middlewares/errorHandler";

export const getAllMaterials = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;
    const vendorId = req.query.vendor as string;
    const category = req.query.category as string;

    const query: Record<string, unknown> = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    if (vendorId) {
      query.vendor = vendorId;
    }

    if (category) {
      query.category = category;
    }

    const materials = await Material.find(query)
      .populate("vendor", "name email mobile business")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Material.countDocuments(query);

    res.json({
      success: true,
      data: materials,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMaterialById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const material = await Material.findById(req.params.id).populate(
      "vendor",
      "name email mobile business",
    );

    if (!material) {
      throw new AppError("Material not found.", 404);
    }

    res.json({
      success: true,
      data: material,
    });
  } catch (error) {
    next(error);
  }
};

export const getMaterialsByVendor = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.params.vendorId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      throw new AppError("Vendor not found.", 404);
    }

    const materials = await Material.find({ vendor: vendorId })
      .populate("vendor", "name email mobile business")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Material.countDocuments({ vendor: vendorId });

    res.json({
      success: true,
      data: materials,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createMaterial = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, description, category, unit, price, vendor, stock } =
      req.body;

    const vendorExists = await Vendor.findById(vendor);

    if (!vendorExists) {
      throw new AppError("Vendor not found.", 404);
    }

    const material = await Material.create({
      name,
      description,
      category,
      unit,
      price,
      vendor,
      stock: stock || 0,
      isActive: true,
    });

    const populatedMaterial = await Material.findById(material._id).populate(
      "vendor",
      "name email mobile business",
    );

    res.status(201).json({
      success: true,
      message: "Material created successfully",
      data: populatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

export const updateMaterial = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, description, category, subCategory, unit, status } = req.body;

    const material = await Material.findById(req.params.id);

    if (!material) {
      throw new AppError("Material not found.", 404);
    }

    if (material.isDeleted) {
      throw new AppError("Cannot update a deleted material.", 400);
    }

    // Validate category if provided
    if (category && category !== material.category.toString()) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        throw new AppError("Category not found.", 404);
      }
    }

    // Validate subCategory if provided
    if (subCategory) {
      const subCategoryExists = await SubCategory.findById(subCategory);
      if (!subCategoryExists) {
        throw new AppError("Sub-category not found.", 404);
      }
    }

    material.name = name || material.name;
    material.description =
      description !== undefined ? description : material.description;
    material.category = category || material.category;
    material.subCategory =
      subCategory !== undefined ? subCategory : material.subCategory;
    material.unit = unit || material.unit;
    material.status = status || material.status;

    await material.save();

    const updatedMaterial = await Material.findById(material._id)
      .populate("category", "name")
      .populate("subCategory", "name");

    res.json({
      success: true,
      message: "Material updated successfully",
      data: updatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMaterial = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      throw new AppError("Material not found.", 404);
    }

    await Material.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Material deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const categories = await Material.distinct("category");

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};
