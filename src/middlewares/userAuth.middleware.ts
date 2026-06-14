import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.model";
import { AppError } from "./errorHandler";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

interface JwtPayload {
  id: string;
  type: string;
}

export interface UserRequest extends Request {
  user?: {
    id: string;
    type: string;
  };
}

/**
 * Authenticate mobile app user
 * Verifies JWT token and attaches user info to request
 */
export const authenticateUser = async (
  req: UserRequest,
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

      if (decoded.type !== "user") {
        throw new AppError("Invalid token type", 401);
      }

      // Check if user exists and is active
      const user = await User.findById(decoded.id).select(
        "_id status isDeleted",
      );

      if (!user) {
        throw new AppError("User not found", 401);
      }

      if (user.isDeleted) {
        throw new AppError("Account has been deleted", 401);
      }

      if (user.status === "blocked") {
        throw new AppError(
          "Your account has been blocked. Please contact support.",
          403,
        );
      }

      req.user = {
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

/**
 * Optional authentication - doesn't throw error if no token
 * Used for routes that work with or without authentication
 */
export const optionalAuthenticateUser = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

      if (decoded.type === "user") {
        const user = await User.findById(decoded.id).select(
          "_id status isDeleted",
        );

        if (user && !user.isDeleted && user.status !== "blocked") {
          req.user = {
            id: decoded.id,
            type: decoded.type,
          };
        }
      }
    } catch {
      // Ignore token errors for optional auth
    }

    next();
  } catch (error) {
    next(error);
  }
};
