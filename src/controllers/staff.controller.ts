import { Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import Staff from "../models/Staff.model";
import Role from "../models/Role.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

const DEFAULT_PASSWORD = "Pass@123";

// Get all staff (with filters + stats)
export const getAllStaff = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 50,
      search = "",
      status,
      role,
      department,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = { isDeleted: false };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { staffId: { $regex: search, $options: "i" } },
      ];
    }

    if (status && ["active", "inactive", "blocked"].includes(status as string)) {
      query.status = status;
    }
    if (role) {
      query.role = { $regex: role, $options: "i" };
    }
    if (department) {
      query.department = { $regex: department, $options: "i" };
    }

    const [staff, total] = await Promise.all([
      Staff.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Staff.countDocuments(query),
    ]);

    // Stats
    const stats = await Staff.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      data: staff,
      stats: stats[0] || { total: 0, active: 0, inactive: 0, blocked: 0 },
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

// Get single staff
export const getStaff = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const staff = await Staff.findById(req.params.id);

    if (!staff || staff.isDeleted) {
      throw new AppError("Staff not found.", 404);
    }

    res.json({ success: true, data: staff });
  } catch (error) {
    next(error);
  }
};

// Create staff (default password: Pass@123)
export const createStaff = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, mobile, roleId, department, status } = req.body;

    if (!name || !email || !mobile || !roleId || !department) {
      throw new AppError(
        "Name, email, mobile, role and department are required.",
        400,
      );
    }

    const roleDoc = await Role.findById(roleId);
    if (!roleDoc) throw new AppError("Selected role does not exist.", 400);
    if (roleDoc.status !== "active") {
      throw new AppError("Selected role is inactive.", 400);
    }

    const existingStaff = await Staff.findOne({
      email: email.toLowerCase(),
      isDeleted: false,
    });
    if (existingStaff) {
      throw new AppError("Email already exists.", 400);
    }

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

    const staff = await Staff.create({
      name,
      email,
      mobile,
      password: hashedPassword,
      role: roleDoc.name,
      roleId: roleDoc._id,
      department,
      status: status || "active",
    });

    res.status(201).json({
      success: true,
      message: "Staff created successfully. Default password: Pass@123",
      data: {
        _id: staff._id,
        staffId: staff.staffId,
        name: staff.name,
        email: staff.email,
        mobile: staff.mobile,
        role: staff.role,
        roleId: staff.roleId,
        department: staff.department,
        status: staff.status,
        createdAt: staff.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Update staff
export const updateStaff = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, mobile, roleId, department, status } = req.body;

    const staff = await Staff.findById(req.params.id);
    if (!staff || staff.isDeleted) {
      throw new AppError("Staff not found.", 404);
    }

    // Check email uniqueness if changed
    if (email && email.toLowerCase() !== staff.email) {
      const existing = await Staff.findOne({
        email: email.toLowerCase(),
        isDeleted: false,
        _id: { $ne: staff._id },
      });
      if (existing) {
        throw new AppError("Email already exists.", 400);
      }
    }

    if (name) staff.name = name;
    if (email) staff.email = email;
    if (mobile) staff.mobile = mobile;
    if (roleId) {
      const roleDoc = await Role.findById(roleId);
      if (!roleDoc) throw new AppError("Selected role does not exist.", 400);
      staff.roleId = roleDoc._id as any;
      staff.role = roleDoc.name;
    }
    if (department) staff.department = department;
    if (status) staff.status = status;

    await staff.save();

    res.json({
      success: true,
      message: "Staff updated successfully.",
      data: staff,
    });
  } catch (error) {
    next(error);
  }
};

// Toggle staff status
export const toggleStaffStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status } = req.body;

    if (!status || !["active", "inactive", "blocked"].includes(status)) {
      throw new AppError("Valid status (active/inactive/blocked) is required.", 400);
    }

    const staff = await Staff.findById(req.params.id);
    if (!staff || staff.isDeleted) {
      throw new AppError("Staff not found.", 404);
    }

    staff.status = status;
    await staff.save();

    res.json({
      success: true,
      message: `Staff status changed to ${status}.`,
      data: staff,
    });
  } catch (error) {
    next(error);
  }
};

// Reset password to default
export const resetStaffPassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const staff = await Staff.findById(req.params.id).select("+password");
    if (!staff || staff.isDeleted) {
      throw new AppError("Staff not found.", 404);
    }

    staff.password = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    await staff.save();

    res.json({
      success: true,
      message: "Password reset to default (Pass@123) successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete staff
export const deleteStaff = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff || staff.isDeleted) {
      throw new AppError("Staff not found.", 404);
    }

    staff.isDeleted = true;
    staff.deletedAt = new Date();
    staff.status = "inactive";
    await staff.save();

    res.json({
      success: true,
      message: "Staff deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// Get roles & departments list (for dropdowns)
export const getStaffMeta = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [roles, departments] = await Promise.all([
      Role.find({ status: "active" }).select("_id name").sort({ name: 1 }),
      Staff.distinct("department", { isDeleted: false }),
    ]);

    res.json({
      success: true,
      data: { roles, departments },
    });
  } catch (error) {
    next(error);
  }
};
