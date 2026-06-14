import { Request } from "express";

export interface IAdmin {
  _id: string;
  name: string;
  email: string;
  password: string;
  role: "super-admin" | "sub-admin";
  permissions: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IVendor {
  _id: string;
  name: string;
  mobile: string;
  email: string;
  business: {
    name: string;
    type: "constructor";
    address: string;
    gstNumber?: string;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMaterial {
  _id: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  price: number;
  vendor: string;
  stock: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  userType: "admin" | "staff";
  permissions: Record<string, Record<string, boolean>> | string[];
  isSuperAdmin: boolean;
}

export interface AuthRequest extends Request {
  admin?: IAdmin;
  user?: AuthUser;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  userType?: "admin" | "staff";
}

export type Permission =
  | "all"
  | "admin:read"
  | "admin:write"
  | "admin:delete"
  | "vendor:read"
  | "vendor:write"
  | "vendor:delete"
  | "material:read"
  | "material:write"
  | "material:delete";

export const MODULES = {
  ADMIN: "admin",
  VENDOR: "vendor",
  MATERIAL: "material",
} as const;

export const PERMISSIONS: Record<string, Permission[]> = {
  admin: ["admin:read", "admin:write", "admin:delete"],
  vendor: ["vendor:read", "vendor:write", "vendor:delete"],
  material: ["material:read", "material:write", "material:delete"],
};
