import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.model";
import Staff from "../models/Staff.model";
import Role from "../models/Role.model";
import {
  AuthRequest,
  JwtPayload,
  Permission,
  IAdmin,
  AuthUser,
} from "../types";
import { AppError } from "./errorHandler";

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("Access denied. No token provided.", 401);
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "default_secret",
    ) as JwtPayload;

    const userType = decoded.userType || "admin";

    if (userType === "staff") {
      const staff = await Staff.findById(decoded.id);

      if (!staff || staff.isDeleted) {
        throw new AppError("Staff account not found.", 404);
      }
      if (staff.status !== "active") {
        throw new AppError(`Account is ${staff.status}.`, 403);
      }

      let permissions: Record<string, Record<string, boolean>> = {};
      if (staff.roleId) {
        const role = await Role.findById(staff.roleId);
        if (role && role.status === "active") {
          permissions = (role.permissions as any) || {};
        }
      }

      req.user = {
        _id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        role: staff.role,
        userType: "staff",
        permissions,
        isSuperAdmin: false,
      } as AuthUser;

      // Populate req.admin shape so legacy controllers using
      // req.admin._id for audit fields (createdBy/updatedBy/deletedBy) keep working.
      req.admin = {
        _id: staff._id.toString(),
        name: staff.name,
        email: staff.email,
        password: "",
        role: staff.role as any,
        permissions: [],
        isActive: staff.status === "active",
        createdAt: staff.createdAt,
        updatedAt: staff.updatedAt,
      } as unknown as IAdmin;

      return next();
    }

    // Admin flow
    const admin = await Admin.findById(decoded.id).select("+password");

    if (!admin) {
      throw new AppError("Admin not found.", 404);
    }
    if (!admin.isActive) {
      throw new AppError("Account is deactivated.", 403);
    }

    const adminObj = admin.toObject();
    req.admin = {
      ...adminObj,
      _id: adminObj._id.toString(),
    } as IAdmin;

    const isSuper =
      admin.role === "super-admin" ||
      (admin.permissions && admin.permissions.includes("all"));

    req.user = {
      _id: admin._id.toString(),
      name: admin.name,
      email: admin.email,
      role: admin.role,
      userType: "admin",
      permissions: admin.permissions || [],
      isSuperAdmin: !!isSuper,
    } as AuthUser;

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError("Invalid token.", 401));
    } else {
      next(error);
    }
  }
};

export const authorize = (...requiredPermissions: Permission[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(new AppError("Authentication required.", 401));
      return;
    }

    if (
      req.admin.role === "super-admin" ||
      req.admin.permissions.includes("all")
    ) {
      next();
      return;
    }

    const hasPermission = requiredPermissions.some((permission) =>
      req.admin!.permissions.includes(permission),
    );

    if (!hasPermission) {
      next(
        new AppError("You do not have permission to perform this action.", 403),
      );
      return;
    }

    next();
  };
};

/**
 * RBAC guard: require module.action permission.
 * Super-admins (admin role) bypass. Staff are checked against their role's permissions matrix.
 */
export const requirePermission = (module: string, action: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError("Authentication required.", 401));
      return;
    }

    if (req.user.isSuperAdmin) {
      next();
      return;
    }

    const perms = req.user.permissions;
    if (Array.isArray(perms)) {
      // Legacy admin permission strings — allow if matches "module:action" or "all"
      if (perms.includes("all") || perms.includes(`${module}:${action}`)) {
        next();
        return;
      }
      next(new AppError("You do not have permission to perform this action.", 403));
      return;
    }

    const allowed = !!perms?.[module]?.[action];
    if (!allowed) {
      next(new AppError("You do not have permission to perform this action.", 403));
      return;
    }
    next();
  };
};
