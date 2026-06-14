import mongoose, { Schema, Document } from "mongoose";

export interface ISellerRequestDocument extends Document {
  user?: mongoose.Types.ObjectId;
  name: string;
  mobile: string;
  email?: string;
  business: {
    name: string;
    gstNumber?: string;
    panNumber?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
  message?: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  convertedVendorId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SellerRequestSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
      validate: {
        validator: function (v: string) {
          return /^[6-9]\d{9}$/.test(v);
        },
        message: "Mobile number must be a valid 10-digit Indian number",
      },
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    business: {
      name: {
        type: String,
        required: [true, "Business name is required"],
        trim: true,
      },
      gstNumber: { type: String, trim: true, uppercase: true },
      panNumber: { type: String, trim: true, uppercase: true },
      address: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    message: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    convertedVendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
  },
  { timestamps: true },
);

SellerRequestSchema.index({ status: 1, createdAt: -1 });
SellerRequestSchema.index({ mobile: 1, status: 1 });
SellerRequestSchema.index({ user: 1, status: 1 });

export default mongoose.model<ISellerRequestDocument>(
  "SellerRequest",
  SellerRequestSchema,
);
