import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import User from "../models/User.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

// Get all users (with pagination and filters)
export const getUsers = async (
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
      isVerified,
      city,
      state,
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

    // Search by name, mobile, or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by status
    if (
      status &&
      ["active", "inactive", "blocked"].includes(status as string)
    ) {
      query.status = status;
    }

    // Filter by verification status
    if (isVerified === "true") {
      query.isVerified = true;
    } else if (isVerified === "false") {
      query.isVerified = false;
    }

    // Filter by city
    if (city) {
      query["address.city"] = { $regex: city, $options: "i" };
    }

    // Filter by state
    if (state) {
      query["address.state"] = { $regex: state, $options: "i" };
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

    const [users, total] = await Promise.all([
      User.find(query)
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(query),
    ]);

    // Get stats
    const stats = await User.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          inactive: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          blocked: {
            $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] },
          },
          verified: {
            $sum: { $cond: ["$isVerified", 1, 0] },
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: users,
      stats: stats[0] || {
        total: 0,
        active: 0,
        inactive: 0,
        blocked: 0,
        verified: 0,
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

// Get single user by ID
export const getUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id)
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email");

    if (!user) {
      throw new AppError("User not found", 404);
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// Update user (mobile cannot be changed)
export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, email, address, status } = req.body;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.isDeleted) {
      throw new AppError("Cannot update a deleted user", 400);
    }

    // Update allowed fields only (mobile is NOT allowed)
    if (name) user.name = name;
    if (email !== undefined) user.email = email || undefined;
    if (status) user.status = status;

    // Update address
    if (address) {
      user.address = {
        street: address.street ?? user.address?.street,
        city: address.city ?? user.address?.city,
        state: address.state ?? user.address?.state,
        pincode: address.pincode ?? user.address?.pincode,
        location: user.address?.location,
      };
    }

    user.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await user.save();

    const updatedUser = await User.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete user
export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.isDeleted) {
      throw new AppError("User is already deleted", 400);
    }

    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await user.save();

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Restore user
export const restoreUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (!user.isDeleted) {
      throw new AppError("User is not deleted", 400);
    }

    user.isDeleted = false;
    user.deletedAt = undefined;
    user.deletedBy = undefined;
    user.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await user.save();

    const restoredUser = await User.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: "User restored successfully",
      data: restoredUser,
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete user
export const permanentDeleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "User permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Toggle user status (active/inactive/blocked)
export const toggleUserStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.isDeleted) {
      throw new AppError("Cannot change status of a deleted user", 400);
    }

    // If status is provided, use it; otherwise toggle between active and blocked
    if (status && ["active", "inactive", "blocked"].includes(status)) {
      user.status = status;
    } else {
      user.status = user.status === "active" ? "blocked" : "active";
    }

    user.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await user.save();

    const updatedUser = await User.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: `User ${user.status} successfully`,
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// Block user
export const blockUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.isDeleted) {
      throw new AppError("Cannot block a deleted user", 400);
    }

    user.status = "blocked";
    user.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await user.save();

    const updatedUser = await User.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: "User blocked successfully",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// Unblock user
export const unblockUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.isDeleted) {
      throw new AppError("Cannot unblock a deleted user", 400);
    }

    user.status = "active";
    user.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await user.save();

    const updatedUser = await User.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: "User unblocked successfully",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// Get user stats
export const getUserStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const stats = await User.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          inactive: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          blocked: {
            $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] },
          },
          verified: {
            $sum: { $cond: ["$isVerified", 1, 0] },
          },
        },
      },
    ]);

    // Get users by city
    const byCity = await User.aggregate([
      {
        $match: {
          isDeleted: false,
          "address.city": { $exists: true, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$address.city",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get users by state
    const byState = await User.aggregate([
      {
        $match: {
          isDeleted: false,
          "address.state": { $exists: true, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$address.state",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get recent registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentRegistrations = await User.countDocuments({
      isDeleted: false,
      createdAt: { $gte: sevenDaysAgo },
    });

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          total: 0,
          active: 0,
          inactive: 0,
          blocked: 0,
          verified: 0,
        },
        byCity,
        byState,
        recentRegistrations,
      },
    });
  } catch (error) {
    next(error);
  }
};
