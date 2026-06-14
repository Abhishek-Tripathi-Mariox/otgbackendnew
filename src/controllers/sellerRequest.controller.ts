import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import SellerRequest from "../models/SellerRequest.model";
import Vendor from "../models/Vendor.model";
import User from "../models/User.model";
import { AuthRequest } from "../types";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { AppError } from "../middlewares/errorHandler";

// ===================== CUSTOMER (mobile) =====================

// Customer submits a "become a seller" request
export const createSellerRequest = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, mobile, email, business, message } = req.body;

    if (!name || !mobile || !business?.name) {
      throw new AppError(
        "Name, mobile and business name are required",
        400,
      );
    }

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      throw new AppError("Enter a valid 10-digit mobile number", 400);
    }

    // Reject if a pending request already exists for this user/mobile
    const existingQuery: any = {
      status: "pending",
      $or: [{ mobile }],
    };
    if (req.user?.id) {
      existingQuery.$or.push({ user: req.user.id });
    }
    const existing = await SellerRequest.findOne(existingQuery);
    if (existing) {
      throw new AppError(
        "A seller request is already pending review",
        409,
      );
    }

    // Also reject if a vendor with this mobile already exists
    const vendorExists = await Vendor.findOne({ mobile, isDeleted: false });
    if (vendorExists) {
      throw new AppError(
        "You are already registered as a vendor",
        409,
      );
    }

    const request = await SellerRequest.create({
      user: req.user?.id || undefined,
      name,
      mobile,
      email: email || undefined,
      business: {
        name: business.name,
        gstNumber: business.gstNumber || undefined,
        panNumber: business.panNumber || undefined,
        address: business.address || undefined,
        city: business.city || undefined,
        state: business.state || undefined,
        pincode: business.pincode || undefined,
      },
      message: message || undefined,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Seller request submitted successfully",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// Customer fetches its own latest seller request (used to hide the button)
export const getMySellerRequest = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.id) {
      throw new AppError("Authentication required", 401);
    }

    // Also match by mobile so a request submitted before the user logged
    // in (or with mobile that matches the user's account) is still found.
    const userDoc = await User.findById(req.user.id).select("mobile");
    const matchClauses: any[] = [{ user: req.user.id }];
    if (userDoc?.mobile) matchClauses.push({ mobile: userDoc.mobile });

    const request = await SellerRequest.findOne({ $or: matchClauses }).sort({
      createdAt: -1,
    });

    res.json({
      success: true,
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// ===================== ADMIN =====================

// List seller requests with filters / pagination
export const listSellerRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "pending",
      search = "",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status && status !== "all") {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { "business.name": { $regex: search, $options: "i" } },
        { "business.city": { $regex: search, $options: "i" } },
      ];
    }

    const [requests, total] = await Promise.all([
      SellerRequest.find(query)
        .populate("user", "name mobile email")
        .populate("reviewedBy", "name email")
        .populate("convertedVendorId", "vendorCode name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      SellerRequest.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: requests,
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

// Get a single request
export const getSellerRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const request = await SellerRequest.findById(id)
      .populate("user", "name mobile email")
      .populate("reviewedBy", "name email")
      .populate("convertedVendorId", "vendorCode name");

    if (!request) throw new AppError("Seller request not found", 404);

    res.json({ success: true, data: request });
  } catch (error) {
    next(error);
  }
};

// Admin updates editable fields of a seller request
export const updateSellerRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, mobile, email, business, message } = req.body;

    const request = await SellerRequest.findById(id);
    if (!request) throw new AppError("Seller request not found", 404);

    if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
      throw new AppError("Enter a valid 10-digit mobile number", 400);
    }

    if (name !== undefined) request.name = name;
    if (mobile !== undefined) request.mobile = mobile;
    if (email !== undefined) request.email = email || undefined;
    if (message !== undefined) request.message = message || undefined;

    if (business) {
      request.business = {
        name: business.name ?? request.business?.name,
        gstNumber: business.gstNumber ?? request.business?.gstNumber,
        panNumber: business.panNumber ?? request.business?.panNumber,
        address: business.address ?? request.business?.address,
        city: business.city ?? request.business?.city,
        state: business.state ?? request.business?.state,
        pincode: business.pincode ?? request.business?.pincode,
      };
      request.markModified("business");
    }

    await request.save();

    const updated = await SellerRequest.findById(id)
      .populate("user", "name mobile email")
      .populate("reviewedBy", "name email")
      .populate("convertedVendorId", "vendorCode name");

    res.json({
      success: true,
      message: "Seller request updated successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Approve: mark as approved. (Admin then completes vendor onboarding via existing Vendors flow.)
export const approveSellerRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const request = await SellerRequest.findById(id);
    if (!request) throw new AppError("Seller request not found", 404);
    if (request.status !== "pending") {
      throw new AppError(
        `Request is already ${request.status}`,
        400,
      );
    }

    request.status = "approved";
    request.reviewedBy = new mongoose.Types.ObjectId(req.admin!._id);
    request.reviewedAt = new Date();
    await request.save();

    res.json({
      success: true,
      message: "Seller request approved",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// Reject
export const rejectSellerRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const request = await SellerRequest.findById(id);
    if (!request) throw new AppError("Seller request not found", 404);
    if (request.status !== "pending") {
      throw new AppError(
        `Request is already ${request.status}`,
        400,
      );
    }

    request.status = "rejected";
    request.rejectionReason = reason || undefined;
    request.reviewedBy = new mongoose.Types.ObjectId(req.admin!._id);
    request.reviewedAt = new Date();
    await request.save();

    res.json({
      success: true,
      message: "Seller request rejected",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// Delete (hard delete) — e.g. cleanup
export const deleteSellerRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const request = await SellerRequest.findByIdAndDelete(id);
    if (!request) throw new AppError("Seller request not found", 404);
    res.json({ success: true, message: "Seller request deleted" });
  } catch (error) {
    next(error);
  }
};

// Counts for badges
export const sellerRequestCounts = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [pending, approved, rejected] = await Promise.all([
      SellerRequest.countDocuments({ status: "pending" }),
      SellerRequest.countDocuments({ status: "approved" }),
      SellerRequest.countDocuments({ status: "rejected" }),
    ]);
    res.json({
      success: true,
      data: { pending, approved, rejected },
    });
  } catch (error) {
    next(error);
  }
};
