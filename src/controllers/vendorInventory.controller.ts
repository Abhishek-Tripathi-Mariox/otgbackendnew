import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Category from "../models/Category.model";
import SubCategory from "../models/SubCategory.model";
import Material from "../models/Material.model";
import VendorMaterial from "../models/VendorMaterial.model";
import { VendorRequest } from "../middlewares/vendorAuth.middleware";
import { AppError } from "../middlewares/errorHandler";

// GET /api/vendor/inventory/categories
export const listCategories = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const categories = await Category.find({
      isDeleted: false,
      status: "active",
    })
      .select("name image")
      .sort({ name: 1 });

    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

// GET /api/vendor/inventory/categories/:id/subcategories
export const listSubCategories = async (
  req: VendorRequest,
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

    res.json({ success: true, data: subCategories });
  } catch (error) {
    next(error);
  }
};

// GET /api/vendor/inventory/materials?category=&subCategory=&search=&page=&limit=
// Returns admin-added master catalog products (filtered)
export const listMaterials = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 50,
      category,
      subCategory,
      search,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = { isDeleted: false, status: "active" };
    if (category) query.category = category;
    if (subCategory) query.subCategory = subCategory;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { brand: { $regex: search, $options: "i" } },
      ];
    }

    const [materials, total] = await Promise.all([
      Material.find(query)
        .select(
          "name images brand category subCategory unit minOrderQty mrp sellingPrice basicPrice",
        )
        .populate("category", "name")
        .populate("subCategory", "name")
        .sort({ name: 1 })
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

// GET /api/vendor/inventory/my-materials
// Authenticated vendor's own VendorMaterial entries
export const listMyMaterials = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const { category, subCategory, search } = req.query;

    const query: any = { vendor: vendorId };

    const vendorMaterials = await VendorMaterial.find(query)
      .populate({
        path: "material",
        select:
          "name images brand category subCategory unit mrp sellingPrice basicPrice",
        populate: [
          { path: "category", select: "name image" },
          { path: "subCategory", select: "name image" },
        ],
      })
      .sort({ createdAt: -1 });

    // Optional client-side filtering after populate
    let filtered = vendorMaterials.filter((vm: any) => vm.material);
    if (category) {
      filtered = filtered.filter(
        (vm: any) => String(vm.material?.category?._id) === String(category),
      );
    }
    if (subCategory) {
      filtered = filtered.filter(
        (vm: any) =>
          String(vm.material?.subCategory?._id) === String(subCategory),
      );
    }
    if (search) {
      const s = String(search).toLowerCase();
      filtered = filtered.filter((vm: any) =>
        vm.material?.name?.toLowerCase().includes(s),
      );
    }

    res.json({ success: true, data: filtered });
  } catch (error) {
    next(error);
  }
};

// GET /api/vendor/inventory/summary
// Returns categories with vendor's stock counts for the inventory dashboard
export const getInventorySummary = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = new mongoose.Types.ObjectId(req.vendor!.id);

    // Group vendor materials by category
    const aggregation = await VendorMaterial.aggregate([
      { $match: { vendor: vendorId } },
      {
        $lookup: {
          from: "materials",
          localField: "material",
          foreignField: "_id",
          as: "material",
        },
      },
      { $unwind: "$material" },
      {
        $lookup: {
          from: "categories",
          localField: "material.category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" },
      {
        $group: {
          _id: "$category._id",
          categoryName: { $first: "$category.name" },
          categoryImage: { $first: "$category.image" },
          unit: { $first: "$material.unit" },
          available: {
            $sum: {
              $cond: [{ $eq: ["$isAvailable", true] }, "$quantity", 0],
            },
          },
          totalProducts: { $sum: 1 },
          totalQuantity: { $sum: "$quantity" },
        },
      },
      { $sort: { categoryName: 1 } },
    ]);

    res.json({ success: true, data: aggregation });
  } catch (error) {
    next(error);
  }
};

// POST /api/vendor/inventory/my-materials
// Vendor adds a material to their inventory (selects from admin catalog)
export const addMyMaterial = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const {
      materialId,
      price,
      quantity,
      minOrderQty,
      maxOrderQty,
      isAvailable,
      specs,
      description,
      images,
    } = req.body;

    if (!materialId) throw new AppError("materialId is required", 400);
    if (price === undefined || price === null)
      throw new AppError("price is required", 400);

    // Verify material exists
    const material = await Material.findOne({
      _id: materialId,
      isDeleted: false,
    });
    if (!material) throw new AppError("Material not found", 404);

    // Check duplicate
    const existing = await VendorMaterial.findOne({
      vendor: vendorId,
      material: materialId,
    });
    if (existing) {
      throw new AppError("This material is already in your inventory", 400);
    }

    const vendorMaterial = await VendorMaterial.create({
      vendor: vendorId,
      material: materialId,
      price,
      quantity: quantity || 0,
      minOrderQty: minOrderQty || 1,
      maxOrderQty: maxOrderQty || undefined,
      isAvailable: isAvailable !== false,
      specs: specs || undefined,
      description: description || undefined,
      images: Array.isArray(images) ? images : [],
      addedByVendor: true,
      verificationStatus: "pending",
    });

    const populated = await VendorMaterial.findById(vendorMaterial._id).populate(
      {
        path: "material",
        populate: [
          { path: "category", select: "name image" },
          { path: "subCategory", select: "name image" },
        ],
      },
    );

    res.status(201).json({
      success: true,
      message:
        "Material added to inventory. Pending admin verification before it appears in marketplace.",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/vendor/inventory/my-materials/:id
export const updateMyMaterial = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const { id } = req.params;
    const {
      price,
      quantity,
      minOrderQty,
      maxOrderQty,
      isAvailable,
      specs,
      description,
      images,
    } = req.body;

    const vm = await VendorMaterial.findOne({ _id: id, vendor: vendorId });
    if (!vm) throw new AppError("Vendor material not found", 404);

    if (price !== undefined) vm.price = price;
    if (quantity !== undefined) vm.quantity = quantity;
    if (minOrderQty !== undefined) vm.minOrderQty = minOrderQty;
    if (maxOrderQty !== undefined) vm.maxOrderQty = maxOrderQty;
    if (isAvailable !== undefined) vm.isAvailable = isAvailable;
    if (specs !== undefined) vm.specs = specs;
    if (description !== undefined) vm.description = description;
    if (Array.isArray(images)) vm.images = images;

    await vm.save();

    const populated = await VendorMaterial.findById(vm._id).populate({
      path: "material",
      populate: [
        { path: "category", select: "name image" },
        { path: "subCategory", select: "name image" },
      ],
    });

    res.json({ success: true, data: populated });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/vendor/inventory/my-materials/:id
export const removeMyMaterial = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = req.vendor!.id;
    const { id } = req.params;

    const result = await VendorMaterial.findOneAndDelete({
      _id: id,
      vendor: vendorId,
    });

    if (!result) throw new AppError("Vendor material not found", 404);

    res.json({ success: true, message: "Material removed from inventory" });
  } catch (error) {
    next(error);
  }
};
