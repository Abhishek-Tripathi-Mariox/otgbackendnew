import mongoose, { Schema, Document } from "mongoose";
import { IAdmin } from "../types";

export interface IAdminDocument extends Omit<IAdmin, "_id">, Document {}

const AdminSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["super-admin", "sub-admin"],
      default: "sub-admin",
    },
    permissions: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Set on every successful login, embedded in the issued JWT, and
    // compared on every authenticated request (auth.middleware.ts) — a
    // login from a new device/browser overwrites this, which invalidates
    // every previously-issued token for the account (multiple concurrent
    // logins is exactly the client-reported bug this closes).
    currentSessionId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IAdminDocument>("Admin", AdminSchema);
