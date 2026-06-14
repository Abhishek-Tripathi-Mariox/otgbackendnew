import { Request, Response, NextFunction } from "express";
import Vendor from "../models/Vendor.model";
import { AppError } from "../middlewares/errorHandler";

export const getAllVendors = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const query: Record<string, unknown> = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { "business.name": { $regex: search, $options: "i" } },
      ];
    }

    const vendors = await Vendor.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Vendor.countDocuments(query);

    res.json({
      success: true,
      data: vendors,
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

export const getVendorById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await Vendor.findById(req.params.id);

    if (!vendor) {
      throw new AppError("Vendor not found.", 404);
    }

    res.json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

export const createVendor = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, mobile, email, business } = req.body;

    const existingVendor = await Vendor.findOne({
      $or: [{ email }, { mobile }],
    });

    if (existingVendor) {
      throw new AppError(
        "Vendor with this email or mobile already exists.",
        400,
      );
    }

    const vendor = await Vendor.create({
      name,
      mobile,
      email,
      business: {
        name: business.name,
        type: "constructor",
        address: business.address,
        gstNumber: business.gstNumber,
      },
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: "Vendor created successfully",
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

export const updateVendor = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, mobile, email, business, isActive } = req.body;

    const vendor = await Vendor.findById(req.params.id);

    if (!vendor) {
      throw new AppError("Vendor not found.", 404);
    }

    if (email && email !== vendor.email) {
      const existingVendor = await Vendor.findOne({ email });
      if (existingVendor) {
        throw new AppError("Email already exists.", 400);
      }
    }

    if (mobile && mobile !== vendor.mobile) {
      const existingVendor = await Vendor.findOne({ mobile });
      if (existingVendor) {
        throw new AppError("Mobile already exists.", 400);
      }
    }

    vendor.name = name || vendor.name;
    vendor.mobile = mobile || vendor.mobile;
    vendor.email = email || vendor.email;
    if (isActive !== undefined) {
      vendor.status = isActive ? "active" : "inactive";
    }

    if (business) {
      vendor.business = {
        name: business.name || vendor.business.name,
        address: business.address || vendor.business.address,
        city: business.city || vendor.business.city,
        state: business.state || vendor.business.state,
        pincode: business.pincode || vendor.business.pincode,
        gstNumber: business.gstNumber || vendor.business.gstNumber,
        panNumber: business.panNumber || vendor.business.panNumber,
      };
    }

    await vendor.save();

    res.json({
      success: true,
      message: "Vendor updated successfully",
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteVendor = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await Vendor.findById(req.params.id);

    if (!vendor) {
      throw new AppError("Vendor not found.", 404);
    }

    await Vendor.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Vendor deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const toggleVendorStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await Vendor.findById(req.params.id);

    if (!vendor) {
      throw new AppError("Vendor not found.", 404);
    }

    vendor.status = vendor.status === "active" ? "inactive" : "active";
    await vendor.save();

    res.json({
      success: true,
      message: `Vendor ${vendor.status === "active" ? "activated" : "deactivated"} successfully`,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};
