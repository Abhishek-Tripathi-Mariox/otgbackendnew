import mongoose, { Schema, Document } from "mongoose";

export interface IVendorMaterialDocument extends Document {
  vendor: mongoose.Types.ObjectId;
  material: mongoose.Types.ObjectId;
  price: number;
  quantity?: number;
  minOrderQty?: number;
  maxOrderQty?: number;
  isAvailable: boolean;
  specs?: string;
  description?: string;
  images?: string[];
  addedByVendor: boolean;
  verificationStatus: "pending" | "approved" | "rejected";
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VendorMaterialSchema: Schema = new Schema(
  {
    vendor: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: [true, "Vendor is required"],
    },
    material: {
      type: Schema.Types.ObjectId,
      ref: "Material",
      required: [true, "Material is required"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    quantity: {
      type: Number,
      min: [0, "Quantity cannot be negative"],
      default: 0,
    },
    minOrderQty: {
      type: Number,
      min: [0, "Minimum order quantity cannot be negative"],
      default: 1,
    },
    maxOrderQty: {
      type: Number,
      min: [0, "Maximum order quantity cannot be negative"],
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    specs: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    images: {
      type: [String],
      default: [],
    },
    addedByVendor: {
      type: Boolean,
      default: false,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Compound unique index to prevent duplicate vendor-material pairs
VendorMaterialSchema.index({ vendor: 1, material: 1 }, { unique: true });

// Indexes for common queries
VendorMaterialSchema.index({ vendor: 1, isAvailable: 1 });
VendorMaterialSchema.index({ material: 1, isAvailable: 1 });
VendorMaterialSchema.index({ price: 1 });
VendorMaterialSchema.index({ addedByVendor: 1, verificationStatus: 1 });

export default mongoose.model<IVendorMaterialDocument>(
  "VendorMaterial",
  VendorMaterialSchema,
);
