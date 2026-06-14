import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.model";
import Staff from "../models/Staff.model";
import Role from "../models/Role.model";
import { AuthRequest, JwtPayload } from "../types";
import { AppError } from "../middlewares/errorHandler";

const generateToken = (payload: JwtPayload): string => {
  const secret = process.env.JWT_SECRET || "default_secret";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError("Email and password are required.", 400);
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Try Admin first
    const admin = await Admin.findOne({ email: normalizedEmail }).select(
      "+password",
    );

    if (admin) {
      if (!admin.isActive) {
        throw new AppError("Account is deactivated.", 403);
      }

      const isPasswordValid = await bcrypt.compare(password, admin.password);
      if (!isPasswordValid) {
        throw new AppError("Invalid credentials.", 401);
      }

      const token = generateToken({
        id: admin._id.toString(),
        email: admin.email,
        role: admin.role,
        userType: "admin",
      });

      res.json({
        success: true,
        message: "Login successful",
        data: {
          token,
          admin: {
            id: admin._id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            permissions: admin.permissions,
            userType: "admin",
            isSuperAdmin:
              admin.role === "super-admin" ||
              (admin.permissions || []).includes("all"),
          },
        },
      });
      return;
    }

    // Then try Staff
    const staff = await Staff.findOne({
      email: normalizedEmail,
      isDeleted: false,
    }).select("+password");

    if (!staff) {
      throw new AppError("Invalid credentials.", 401);
    }

    if (staff.status !== "active") {
      throw new AppError(`Account is ${staff.status}.`, 403);
    }

    const isStaffPwValid = await bcrypt.compare(password, staff.password);
    if (!isStaffPwValid) {
      throw new AppError("Invalid credentials.", 401);
    }

    let rolePermissions: any = {};
    if (staff.roleId) {
      const role = await Role.findById(staff.roleId);
      if (role && role.status === "active") {
        rolePermissions = role.permissions || {};
      }
    }

    staff.lastLogin = new Date();
    await staff.save();

    const token = generateToken({
      id: staff._id.toString(),
      email: staff.email,
      role: staff.role,
      userType: "staff",
    });

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        admin: {
          id: staff._id,
          name: staff.name,
          email: staff.email,
          role: staff.role,
          permissions: rolePermissions,
          userType: "staff",
          isSuperAdmin: false,
          department: staff.department,
          staffId: staff.staffId,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError("Not authenticated.", 401);
    }

    res.json({
      success: true,
      data: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        permissions: req.user.permissions,
        userType: req.user.userType,
        isSuperAdmin: req.user.isSuperAdmin,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError(
        "Current password and new password are required.",
        400,
      );
    }
    if (newPassword.length < 8) {
      throw new AppError("New password must be at least 8 characters.", 400);
    }
    if (!req.user) {
      throw new AppError("Not authenticated.", 401);
    }

    if (req.user.userType === "staff") {
      const staff = await Staff.findById(req.user._id).select("+password");
      if (!staff) throw new AppError("Staff not found.", 404);

      const isValid = await bcrypt.compare(currentPassword, staff.password);
      if (!isValid) throw new AppError("Current password is incorrect.", 401);

      staff.password = await bcrypt.hash(newPassword, 12);
      await staff.save();

      res.json({ success: true, message: "Password changed successfully" });
      return;
    }

    const admin = await Admin.findById(req.user._id).select("+password");
    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      admin.password,
    );

    if (!isPasswordValid) {
      throw new AppError("Current password is incorrect.", 401);
    }

    admin.password = await bcrypt.hash(newPassword, 12);
    await admin.save();

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Generate reset token
const generateResetToken = (): string => {
  return jwt.sign(
    { type: "reset" },
    process.env.JWT_SECRET || "default_secret",
    { expiresIn: "1h" },
  );
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError("Email is required.", 400);
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      // Don't reveal if email exists for security
      res.json({
        success: true,
        message: "If this email exists, a password reset link has been sent.",
      });
      return;
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { id: admin._id.toString(), email: admin.email, type: "reset" },
      process.env.JWT_SECRET || "default_secret",
      { expiresIn: "1h" },
    );

    // In production, send email with reset link
    // For now, we'll just return success
    // TODO: Implement email sending with reset link: /reset-password/${resetToken}

    res.json({
      success: true,
      message: "If this email exists, a password reset link has been sent.",
      // Only for development - remove in production
      ...(process.env.NODE_ENV === "development" && { resetToken }),
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new AppError("Token and new password are required.", 400);
    }

    // Verify token
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret");
    } catch (err) {
      throw new AppError("Invalid or expired reset token.", 400);
    }

    if (decoded.type !== "reset") {
      throw new AppError("Invalid reset token.", 400);
    }

    const admin = await Admin.findById(decoded.id);

    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }

    // Update password
    admin.password = await bcrypt.hash(newPassword, 12);
    await admin.save();

    res.json({
      success: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    next(error);
  }
};
