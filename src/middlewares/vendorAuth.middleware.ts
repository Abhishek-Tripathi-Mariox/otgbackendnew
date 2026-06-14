import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Vendor from "../models/Vendor.model";
import { AppError } from "./errorHandler";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

interface JwtPayload {
  id: string;
  type: string;
}

export interface VendorRequest extends Request {
  vendor?: {
    id: string;
    type: string;
  };
}

/**
 * Authenticate vendor app user
 * Verifies JWT token and attaches vendor info to request
 */
export const authenticateVendor = async (
  req: VendorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("No token provided", 401);
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

      if (decoded.type !== "vendor") {
        throw new AppError("Invalid token type", 401);
      }

      const vendor = await Vendor.findById(decoded.id).select(
        "_id status isDeleted",
      );

      if (!vendor) {
        throw new AppError("Vendor not found", 401);
      }

      if (vendor.isDeleted) {
        throw new AppError("Account has been deleted", 401);
      }

      if (vendor.status === "inactive") {
        throw new AppError(
          "Your account is inactive. Please contact support.",
          403,
        );
      }

      req.vendor = {
        id: decoded.id,
        type: decoded.type,
      };

      next();
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        throw new AppError("Token has expired", 401);
      }
      if (jwtError instanceof jwt.JsonWebTokenError) {
        throw new AppError("Invalid token", 401);
      }
      throw jwtError;
    }
  } catch (error) {
    next(error);
  }
};
