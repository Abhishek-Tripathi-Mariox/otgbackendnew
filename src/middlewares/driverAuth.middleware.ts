import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Driver from "../models/Driver.model";
import { AppError } from "./errorHandler";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

interface JwtPayload {
  id: string;
  type: string;
}

export interface DriverRequest extends Request {
  driver?: {
    id: string;
    type: string;
  };
}

export const authenticateDriver = async (
  req: DriverRequest,
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

      if (decoded.type !== "driver") {
        throw new AppError("Invalid token type", 401);
      }

      const driver = await Driver.findById(decoded.id).select(
        "_id status isDeleted",
      );

      if (!driver) throw new AppError("Driver not found", 401);
      if (driver.isDeleted)
        throw new AppError("Account has been deleted", 401);
      if (driver.status === "blocked") {
        throw new AppError(
          "Your account has been blocked. Please contact support.",
          403,
        );
      }

      req.driver = { id: decoded.id, type: decoded.type };
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
