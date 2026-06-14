import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import Admin from "../models/Admin.model";
import { AppError } from "../middlewares/errorHandler";

export const getAllAdmins = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const admins = await Admin.find()
      .select("-password")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Admin.countDocuments();

    res.json({
      success: true,
      data: admins,
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

export const getAdminById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const admin = await Admin.findById(req.params.id).select("-password");

    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }

    res.json({
      success: true,
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

export const createSubAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, password, permissions } = req.body;

    const existingAdmin = await Admin.findOne({ email });

    if (existingAdmin) {
      throw new AppError("Email already exists.", 400);
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const admin = await Admin.create({
      name,
      email,
      password: hashedPassword,
      role: "sub-admin",
      permissions: permissions || [],
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: "Sub-admin created successfully",
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateSubAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, permissions, isActive } = req.body;

    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }

    if (admin.role === "super-admin") {
      throw new AppError("Cannot modify super-admin.", 403);
    }

    if (email && email !== admin.email) {
      const existingAdmin = await Admin.findOne({ email });
      if (existingAdmin) {
        throw new AppError("Email already exists.", 400);
      }
    }

    admin.name = name || admin.name;
    admin.email = email || admin.email;
    admin.permissions = permissions || admin.permissions;
    admin.isActive = isActive !== undefined ? isActive : admin.isActive;

    await admin.save();

    res.json({
      success: true,
      message: "Sub-admin updated successfully",
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        isActive: admin.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSubAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }

    if (admin.role === "super-admin") {
      throw new AppError("Cannot delete super-admin.", 403);
    }

    await Admin.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Sub-admin deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const updatePermissions = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { permissions } = req.body;

    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }

    if (admin.role === "super-admin") {
      throw new AppError("Cannot modify super-admin permissions.", 403);
    }

    admin.permissions = permissions;
    await admin.save();

    res.json({
      success: true,
      message: "Permissions updated successfully",
      data: {
        id: admin._id,
        name: admin.name,
        permissions: admin.permissions,
      },
    });
  } catch (error) {
    next(error);
  }
};
