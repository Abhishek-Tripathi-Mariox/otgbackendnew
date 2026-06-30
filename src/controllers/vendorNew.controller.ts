import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Vendor from "../models/Vendor.model";
import VendorMaterial from "../models/VendorMaterial.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

// Get all vendors (with pagination and filters)
export const getVendors = async (
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
      city,
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

    // Search by name, mobile, business name, or city
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { "business.name": { $regex: search, $options: "i" } },
        { "business.city": { $regex: search, $options: "i" } },
      ];
    }

    // Filter by status
    if (status && (status === "active" || status === "inactive")) {
      query.status = status;
    }

    // Filter by city
    if (city) {
      query["business.city"] = { $regex: city, $options: "i" };
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

    const [vendors, total] = await Promise.all([
      Vendor.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Vendor.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: vendors,
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

// Get single vendor by ID
export const getVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email");

    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    res.json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

// Get vendors by location (within radius)
export const getVendorsByLocation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { longitude, latitude, radius = 10 } = req.query;

    if (!longitude || !latitude) {
      throw new AppError("Longitude and latitude are required", 400);
    }

    const lng = parseFloat(longitude as string);
    const lat = parseFloat(latitude as string);
    const radiusInKm = parseFloat(radius as string);

    // Convert km to meters for MongoDB
    const radiusInMeters = radiusInKm * 1000;

    const vendors = await Vendor.find({
      isDeleted: false,
      status: "active",
      location: {
        $nearSphere: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          $maxDistance: radiusInMeters,
        },
      },
    })
      .populate("createdBy", "name email")
      .limit(50);

    res.json({
      success: true,
      data: vendors,
      meta: {
        center: { longitude: lng, latitude: lat },
        radiusKm: radiusInKm,
        count: vendors.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Create vendor
export const createVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, mobile, email, business, location, status, bankDetails } =
      req.body;
    // Check if vendor with same mobile exists
    const existingVendor = await Vendor.findOne({ mobile, isDeleted: false });
    if (existingVendor) {
      throw new AppError("Vendor with this mobile number already exists", 400);
    }

    // Check if email exists (if provided)
    if (email) {
      const emailExists = await Vendor.findOne({ email, isDeleted: false });
      if (emailExists) {
        throw new AppError("Vendor with this email already exists", 400);
      }
    }

    // Validate bank details
    if (
      !bankDetails ||
      !bankDetails.accountHolderName ||
      !bankDetails.accountNumber ||
      !bankDetails.bankName ||
      !bankDetails.ifscCode
    ) {
      throw new AppError(
        "Bank details (account holder name, account number, bank name, IFSC code) are required",
        400,
      );
    }

    const vendor = await Vendor.create({
      name,
      mobile,
      email: email || undefined,
      business: {
        name: business.name,
        gstNumber: business.gstNumber || undefined,
        panNumber: business.panNumber || undefined,
        address: business.address,
        city: business.city,
        state: business.state,
        pincode: business.pincode,
      },
      location: {
        type: "Point",
        coordinates: [location.longitude, location.latitude],
        address: location.address || undefined,
      },
      bankDetails: {
        accountHolderName: bankDetails.accountHolderName,
        accountNumber: bankDetails.accountNumber,
        bankName: bankDetails.bankName,
        ifscCode: bankDetails.ifscCode,
        branchName: bankDetails.branchName || undefined,
      },
      status: status || "active",
      addedByAdmin: true,
      createdBy: new mongoose.Types.ObjectId(req.admin!._id),
    });

    const populatedVendor = await Vendor.findById(vendor._id).populate(
      "createdBy",
      "name email",
    );

    res.status(201).json({
      success: true,
      message: "Vendor created successfully",
      data: populatedVendor,
    });
  } catch (error) {
    next(error);
  }
};

// Update vendor
export const updateVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, mobile, email, business, location, status, bankDetails } =
      req.body;

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    if (vendor.isDeleted) {
      throw new AppError("Cannot update a deleted vendor", 400);
    }

    // Check if mobile exists for another vendor
    if (mobile && mobile !== vendor.mobile) {
      const mobileExists = await Vendor.findOne({
        mobile,
        _id: { $ne: id },
        isDeleted: false,
      });
      if (mobileExists) {
        throw new AppError(
          "Another vendor with this mobile already exists",
          400,
        );
      }
      vendor.mobile = mobile;
    }

    // Check if email exists for another vendor
    if (email && email !== vendor.email) {
      const emailExists = await Vendor.findOne({
        email,
        _id: { $ne: id },
        isDeleted: false,
      });
      if (emailExists) {
        throw new AppError(
          "Another vendor with this email already exists",
          400,
        );
      }
    }

    // Update fields
    if (name) vendor.name = name;
    if (email !== undefined) vendor.email = email || undefined;
    if (status) vendor.status = status;

    // Update business info
    if (business) {
      vendor.business = {
        name: business.name || vendor.business.name,
        gstNumber: business.gstNumber ?? vendor.business.gstNumber,
        panNumber: business.panNumber ?? vendor.business.panNumber,
        address: business.address || vendor.business.address,
        city: business.city || vendor.business.city,
        state: business.state || vendor.business.state,
        pincode: business.pincode || vendor.business.pincode,
      };
    }

    // Update location
    if (location && location.longitude && location.latitude) {
      vendor.location = {
        type: "Point",
        coordinates: [location.longitude, location.latitude],
        address: location.address || vendor.location?.address,
      };
    }

    // Update bank details
    if (bankDetails) {
      vendor.bankDetails = {
        accountHolderName:
          bankDetails.accountHolderName ||
          vendor.bankDetails?.accountHolderName,
        accountNumber:
          bankDetails.accountNumber || vendor.bankDetails?.accountNumber,
        bankName: bankDetails.bankName || vendor.bankDetails?.bankName,
        ifscCode: bankDetails.ifscCode || vendor.bankDetails?.ifscCode,
        branchName: bankDetails.branchName ?? vendor.bankDetails?.branchName,
      };
      vendor.markModified('bankDetails');
    }

    // Ensure business subdocument changes are persisted
    if (business) {
      vendor.markModified('business');
    }

    // Vendors created via the vendor app onboarding have no createdBy.
    // Backfill it so a full-document save doesn't fail on this path.
    if (!vendor.createdBy) {
      vendor.createdBy = new mongoose.Types.ObjectId(req.admin!._id);
    }
    vendor.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    // Only validate the fields we actually changed — avoids validation/cast
    // errors on legacy untouched paths (e.g. createdBy on older records).
    await vendor.save({ validateModifiedOnly: true });

    const updatedVendor = await Vendor.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Vendor updated successfully",
      data: updatedVendor,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete vendor
export const deleteVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    if (vendor.isDeleted) {
      throw new AppError("Vendor is already deleted", 400);
    }

    vendor.isDeleted = true;
    vendor.deletedAt = new Date();
    vendor.deletedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendor.save({ validateModifiedOnly: true });

    res.json({
      success: true,
      message: "Vendor deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore vendor
export const restoreVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    if (!vendor.isDeleted) {
      throw new AppError("Vendor is not deleted", 400);
    }

    vendor.isDeleted = false;
    vendor.deletedAt = undefined;
    vendor.deletedBy = undefined;
    vendor.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendor.save({ validateModifiedOnly: true });

    const restoredVendor = await Vendor.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Vendor restored successfully",
      data: restoredVendor,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete vendor
export const permanentDeleteVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    // Delete all vendor materials first
    await VendorMaterial.deleteMany({ vendor: id });

    // Delete the vendor
    await Vendor.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Vendor permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle vendor status
export const toggleVendorStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    if (vendor.isDeleted) {
      throw new AppError("Cannot toggle status of a deleted vendor", 400);
    }

    vendor.status = vendor.status === "active" ? "inactive" : "active";
    vendor.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendor.save({ validateModifiedOnly: true });

    const updatedVendor = await Vendor.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: `Vendor ${vendor.status === "active" ? "activated" : "deactivated"} successfully`,
      data: updatedVendor,
    });
  } catch (error) {
    next(error);
  }
};

// Approve a self-registered vendor (admin reviews uploaded documents).
export const approveVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);
    if (!vendor) throw new AppError("Vendor not found", 404);
    if (vendor.isDeleted) {
      throw new AppError("Cannot approve a deleted vendor", 400);
    }

    vendor.approvalStatus = "approved";
    vendor.status = "active";
    vendor.isVerified = true;
    vendor.rejectionReason = undefined;
    vendor.approvedBy = new mongoose.Types.ObjectId(req.admin!._id);
    vendor.approvedAt = new Date();
    if (!vendor.createdBy) {
      vendor.createdBy = new mongoose.Types.ObjectId(req.admin!._id);
    }
    vendor.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendor.save({ validateModifiedOnly: true });

    const updatedVendor = await Vendor.findById(id)
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email");

    res.json({
      success: true,
      message: "Vendor approved successfully",
      data: updatedVendor,
    });
  } catch (error) {
    next(error);
  }
};

// Reject a self-registered vendor (with an optional reason).
export const rejectVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const vendor = await Vendor.findById(id);
    if (!vendor) throw new AppError("Vendor not found", 404);
    if (vendor.isDeleted) {
      throw new AppError("Cannot reject a deleted vendor", 400);
    }

    // Keep status active & isVerified as-is so the vendor can still log in to
    // see the reason and re-apply. Order access is gated by approvalStatus.
    vendor.approvalStatus = "rejected";
    vendor.rejectionReason = reason || "Application rejected by admin.";
    if (!vendor.createdBy) {
      vendor.createdBy = new mongoose.Types.ObjectId(req.admin!._id);
    }
    vendor.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendor.save({ validateModifiedOnly: true });

    const updatedVendor = await Vendor.findById(id).populate(
      "createdBy",
      "name email",
    );

    res.json({
      success: true,
      message: "Vendor rejected",
      data: updatedVendor,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== VENDOR MATERIALS ====================

// Get materials for a vendor
export const getVendorMaterials = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vendorId } = req.params;
    const { page = 1, limit = 20, search = "", isAvailable } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // Verify vendor exists
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    const query: any = { vendor: vendorId };

    if (isAvailable === "true") {
      query.isAvailable = true;
    } else if (isAvailable === "false") {
      query.isAvailable = false;
    }

    const [vendorMaterials, total] = await Promise.all([
      VendorMaterial.find(query)
        .populate({
          path: "material",
          populate: [
            { path: "category", select: "name" },
            { path: "subCategory", select: "name" },
          ],
        })
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      VendorMaterial.countDocuments(query),
    ]);

    // Filter by search if provided (search in material name)
    let filteredMaterials = vendorMaterials;
    if (search) {
      const searchLower = (search as string).toLowerCase();
      filteredMaterials = vendorMaterials.filter((vm: any) =>
        vm.material?.name?.toLowerCase().includes(searchLower),
      );
    }

    res.json({
      success: true,
      data: filteredMaterials,
      vendor: {
        _id: vendor._id,
        name: vendor.name,
        business: vendor.business,
      },
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

// Add material to vendor
export const addVendorMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vendorId } = req.params;
    const { materialId, price, minOrderQty, maxOrderQty, isAvailable, specs } =
      req.body;

    // Verify vendor exists
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      throw new AppError("Vendor not found", 404);
    }

    if (vendor.isDeleted) {
      throw new AppError("Cannot add materials to a deleted vendor", 400);
    }

    // Check if material already exists for this vendor
    const existingMapping = await VendorMaterial.findOne({
      vendor: vendorId,
      material: materialId,
    });

    if (existingMapping) {
      throw new AppError("This material is already added to the vendor", 400);
    }

    const vendorMaterial = await VendorMaterial.create({
      vendor: vendorId,
      material: materialId,
      price,
      minOrderQty: minOrderQty || 1,
      maxOrderQty: maxOrderQty || undefined,
      isAvailable: isAvailable !== false,
      specs: specs || undefined,
      createdBy: new mongoose.Types.ObjectId(req.admin!._id),
    });

    const populatedMaterial = await VendorMaterial.findById(vendorMaterial._id)
      .populate({
        path: "material",
        populate: [
          { path: "category", select: "name" },
          { path: "subCategory", select: "name" },
        ],
      })
      .populate("createdBy", "name email");

    res.status(201).json({
      success: true,
      message: "Material added to vendor successfully",
      data: populatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

// Update vendor material
export const updateVendorMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vendorId, materialId } = req.params;
    const { price, minOrderQty, maxOrderQty, isAvailable, specs } = req.body;

    const vendorMaterial = await VendorMaterial.findOne({
      vendor: vendorId,
      material: materialId,
    });

    if (!vendorMaterial) {
      throw new AppError("Vendor material not found", 404);
    }

    if (price !== undefined) vendorMaterial.price = price;
    if (minOrderQty !== undefined) vendorMaterial.minOrderQty = minOrderQty;
    if (maxOrderQty !== undefined) vendorMaterial.maxOrderQty = maxOrderQty;
    if (isAvailable !== undefined) vendorMaterial.isAvailable = isAvailable;
    if (specs !== undefined) vendorMaterial.specs = specs;

    vendorMaterial.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendorMaterial.save({ validateModifiedOnly: true });

    const updatedMaterial = await VendorMaterial.findById(vendorMaterial._id)
      .populate({
        path: "material",
        populate: [
          { path: "category", select: "name" },
          { path: "subCategory", select: "name" },
        ],
      })
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: "Vendor material updated successfully",
      data: updatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

// Remove material from vendor
export const removeVendorMaterial = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vendorId, materialId } = req.params;

    const result = await VendorMaterial.findOneAndDelete({
      vendor: vendorId,
      material: materialId,
    });

    if (!result) {
      throw new AppError("Vendor material not found", 404);
    }

    res.json({
      success: true,
      message: "Material removed from vendor successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle vendor material availability
export const toggleVendorMaterialAvailability = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vendorId, materialId } = req.params;

    const vendorMaterial = await VendorMaterial.findOne({
      vendor: vendorId,
      material: materialId,
    });

    if (!vendorMaterial) {
      throw new AppError("Vendor material not found", 404);
    }

    vendorMaterial.isAvailable = !vendorMaterial.isAvailable;
    vendorMaterial.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await vendorMaterial.save({ validateModifiedOnly: true });

    const updatedMaterial = await VendorMaterial.findById(vendorMaterial._id)
      .populate({
        path: "material",
        populate: [
          { path: "category", select: "name" },
          { path: "subCategory", select: "name" },
        ],
      })
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      success: true,
      message: `Material ${vendorMaterial.isAvailable ? "enabled" : "disabled"} successfully`,
      data: updatedMaterial,
    });
  } catch (error) {
    next(error);
  }
};

// Get all states (for dropdown)
export const getStates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const states = [
      "Andhra Pradesh",
      "Arunachal Pradesh",
      "Assam",
      "Bihar",
      "Chhattisgarh",
      "Goa",
      "Gujarat",
      "Haryana",
      "Himachal Pradesh",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Madhya Pradesh",
      "Maharashtra",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Odisha",
      "Punjab",
      "Rajasthan",
      "Sikkim",
      "Tamil Nadu",
      "Telangana",
      "Tripura",
      "Uttar Pradesh",
      "Uttarakhand",
      "West Bengal",
      "Andaman and Nicobar Islands",
      "Chandigarh",
      "Dadra and Nagar Haveli and Daman and Diu",
      "Delhi",
      "Jammu and Kashmir",
      "Ladakh",
      "Lakshadweep",
      "Puducherry",
    ];

    res.json({
      success: true,
      data: states,
    });
  } catch (error) {
    next(error);
  }
};
