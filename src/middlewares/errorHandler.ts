import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

interface CustomError extends Error {
  statusCode?: number;
  errors?: unknown[];
  code?: number;
  keyValue?: Record<string, unknown>;
  path?: string;
  kind?: string;
}

const FRIENDLY_FIELD_LABELS: Record<string, string> = {
  insuranceExpiry: "Insurance expiry date",
  dateOfBirth: "Date of birth",
  registrationNo: "Registration number",
  mobile: "Mobile number",
  email: "Email",
  ifsc: "IFSC code",
  accountNumber: "Account number",
  pincode: "Pincode",
  year: "Year",
};

const labelFor = (path?: string) => {
  if (!path) return "Value";
  // path can be nested like "vehicles.0.insuranceExpiry"
  const last = path.split(".").pop() || path;
  return FRIENDLY_FIELD_LABELS[last] || last;
};

const friendlyForCast = (err: any): string => {
  if (err?.kind === "date" || err?.kind === "Date") {
    return `${labelFor(err.path)} is not a valid date. Please use YYYY-MM-DD.`;
  }
  if (err?.kind === "Number" || err?.kind === "number") {
    return `${labelFor(err.path)} must be a number.`;
  }
  if (err?.kind === "ObjectId") {
    return "Invalid ID.";
  }
  return `${labelFor(err.path)} is invalid.`;
};

const friendlyForValidation = (err: mongoose.Error.ValidationError): {
  message: string;
  errors: Array<{ field: string; message: string }>;
} => {
  const fieldErrors = Object.values(err.errors).map((e: any) => {
    if (e.name === "CastError") {
      return {
        field: e.path,
        message: friendlyForCast(e),
      };
    }
    return {
      field: e.path,
      message: e.message || `${labelFor(e.path)} is invalid.`,
    };
  });

  // Use the first field error as the headline so the app can show one toast.
  return {
    message: fieldErrors[0]?.message || "Some fields are invalid.",
    errors: fieldErrors,
  };
};

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Something went wrong. Please try again.";
  let errors: unknown[] = err.errors || [];

  // Mongoose schema validation errors
  if (err instanceof mongoose.Error.ValidationError) {
    const friendly = friendlyForValidation(err);
    statusCode = 400;
    message = friendly.message;
    errors = friendly.errors;
  }

  // Mongoose cast errors (bad date, bad ObjectId, bad number)
  else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = friendlyForCast(err);
  }

  // Duplicate key (unique index violation)
  else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = field
      ? `${labelFor(field)} is already in use.`
      : "This value is already in use.";
  }

  // Don't leak unknown 500s to the client.
  // AppError instances are intentional and pass through.
  else if (statusCode >= 500) {
    message = "Something went wrong. Please try again.";
  }

  // Always log the real error server-side for debugging.
  if (process.env.NODE_ENV !== "test") {
    console.error("[errorHandler]", {
      method: req.method,
      url: req.originalUrl,
      status: statusCode,
      original: err.message,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export class AppError extends Error {
  statusCode: number;
  errors: unknown[];

  constructor(message: string, statusCode: number, errors: unknown[] = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}
