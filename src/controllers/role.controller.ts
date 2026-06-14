import { Response, NextFunction } from "express";
import Role, { RBAC_MODULES, RBAC_ACTIONS } from "../models/Role.model";
import Staff from "../models/Staff.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

const sanitizePermissions = (input: any): Record<string, Record<string, boolean>> => {
  const out: Record<string, Record<string, boolean>> = {};
  if (!input || typeof input !== "object") return out;
  for (const mod of RBAC_MODULES) {
    out[mod] = {};
    for (const act of RBAC_ACTIONS) {
      out[mod][act] = !!input?.[mod]?.[act];
    }
  }
  return out;
};

export const getAllRoles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const roles = await Role.find().sort({ isSystem: -1, createdAt: 1 });

    // Attach staffCount per role
    const counts = await Staff.aggregate([
      { $match: { isDeleted: false, roleId: { $ne: null } } },
      { $group: { _id: "$roleId", count: { $sum: 1 } } },
    ]);
    const map = new Map(counts.map((c: any) => [String(c._id), c.count]));

    const data = roles.map((r) => ({
      ...r.toObject(),
      staffCount: map.get(String(r._id)) || 0,
    }));

    res.json({
      success: true,
      data,
      meta: { modules: RBAC_MODULES, actions: RBAC_ACTIONS },
    });
  } catch (error) {
    next(error);
  }
};

export const getRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) throw new AppError("Role not found.", 404);
    res.json({ success: true, data: role });
  } catch (error) {
    next(error);
  }
};

export const createRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, description, status, permissions } = req.body;
    if (!name || !String(name).trim()) {
      throw new AppError("Role name is required.", 400);
    }

    const exists = await Role.findOne({ name: name.trim() });
    if (exists) throw new AppError("A role with this name already exists.", 400);

    const role = await Role.create({
      name: name.trim(),
      description: description || "",
      status: status === "inactive" ? "inactive" : "active",
      isSystem: false,
      permissions: sanitizePermissions(permissions),
    });

    res.status(201).json({
      success: true,
      message: "Role created successfully.",
      data: role,
    });
  } catch (error) {
    next(error);
  }
};

export const updateRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) throw new AppError("Role not found.", 404);

    if (role.isSystem) {
      // Allow updating permissions/status/description but not the name
      const { description, status, permissions } = req.body;
      if (description !== undefined) role.description = description;
      if (status) role.status = status === "inactive" ? "inactive" : "active";
      if (permissions) role.permissions = sanitizePermissions(permissions);
      await role.save();
      res.json({ success: true, message: "Role updated.", data: role });
      return;
    }

    const { name, description, status, permissions } = req.body;

    if (name && name.trim() !== role.name) {
      const dup = await Role.findOne({ name: name.trim(), _id: { $ne: role._id } });
      if (dup) throw new AppError("A role with this name already exists.", 400);
      role.name = name.trim();
    }
    if (description !== undefined) role.description = description;
    if (status) role.status = status === "inactive" ? "inactive" : "active";
    if (permissions) role.permissions = sanitizePermissions(permissions);

    await role.save();

    // Sync the denormalized role name on staff if name changed
    await Staff.updateMany({ roleId: role._id }, { $set: { role: role.name } });

    res.json({ success: true, message: "Role updated.", data: role });
  } catch (error) {
    next(error);
  }
};

export const deleteRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) throw new AppError("Role not found.", 404);
    if (role.isSystem) throw new AppError("System roles cannot be deleted.", 400);

    const inUse = await Staff.countDocuments({ roleId: role._id, isDeleted: false });
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete: ${inUse} staff member(s) are assigned to this role.`,
        400,
      );
    }

    await role.deleteOne();
    res.json({ success: true, message: "Role deleted." });
  } catch (error) {
    next(error);
  }
};

export const getRoleMeta = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    res.json({
      success: true,
      data: { modules: RBAC_MODULES, actions: RBAC_ACTIONS },
    });
  } catch (error) {
    next(error);
  }
};
