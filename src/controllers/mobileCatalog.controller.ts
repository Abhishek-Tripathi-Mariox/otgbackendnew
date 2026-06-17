import { Request, Response, NextFunction } from "express";
import Category from "../models/Category.model";
import Brand from "../models/Brand.model";
import SubCategory from "../models/SubCategory.model";
import Material from "../models/Material.model";
import Banner from "../models/Banner.model";

// GET /api/mobile/categories - Get all active categories
export const getCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const categories = await Category.find({
      isDeleted: false,
      status: "active",
    })
      .select("name image order")
      .sort({ order: 1, name: 1 });

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/catalog/brands - Get all active brands
export const getBrands = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const brands = await Brand.find({
      isDeleted: false,
      status: "active",
    })
      .select("name image")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: brands,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/categories/:id/subcategories - Get subcategories for a category
export const getSubCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategories = await SubCategory.find({
      category: id,
      isDeleted: false,
      status: "active",
    })
      .select("name image category")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: subCategories,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/materials - Get materials (with filters)
export const getMaterials = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      subCategory,
      search,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {
      isDeleted: false,
      status: "active",
    };

    if (category) {
      query.category = category;
    }

    if (subCategory) {
      query.subCategory = subCategory;
    }

    if (search) {
      const searchRegex = { $regex: search as string, $options: "i" };

      // Category/subCategory are ObjectId refs, so a regex can't match their
      // names directly — resolve matching ids first and fold them into the $or.
      const [matchedCategories, matchedSubCategories] = await Promise.all([
        Category.find({
          name: searchRegex,
          isDeleted: false,
          status: "active",
        }).select("_id"),
        SubCategory.find({
          name: searchRegex,
          isDeleted: false,
          status: "active",
        }).select("_id"),
      ]);

      query.$or = [
        { name: searchRegex },
        { brand: searchRegex },
        { description: searchRegex },
        { category: { $in: matchedCategories.map((c) => c._id) } },
        { subCategory: { $in: matchedSubCategories.map((s) => s._id) } },
      ];
    }

    const [materials, total] = await Promise.all([
      Material.find(query)
        .select(
          "name images brand category subCategory unit minOrderQty mrp sellingPrice finalSellingPrice gst requestQuote",
        )
        .populate("category", "name")
        .populate("subCategory", "name")
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

// GET /api/mobile/materials/:id - Get single material detail
export const getMaterialDetail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findOne({
      _id: id,
      isDeleted: false,
      status: "active",
    })
      .populate("category", "name")
      .populate("subCategory", "name");

    if (!material) {
      res.status(404).json({
        success: false,
        message: "Material not found",
      });
      return;
    }

    res.json({
      success: true,
      data: material,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/catalog/banners - Get active banners
export const getBanners = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const banners = await Banner.find({
      isDeleted: false,
      status: "active",
    })
      .select("title image link order enableBulkQuote")
      .sort({ order: 1 });

    res.json({
      success: true,
      data: banners,
    });
  } catch (error) {
    next(error);
  }
};
