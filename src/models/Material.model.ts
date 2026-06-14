import mongoose, { Document, Schema } from "mongoose";

export interface IMaterial extends Document {
  name: string;
  images: string[];
  description?: string;
  specs?: string;
  brand?: string;
  category: mongoose.Types.ObjectId;
  subCategory?: mongoose.Types.ObjectId | null;
  unit: string;
  minOrderQty: number;
  diameter?: string;
  basicPrice: number;
  mrp: number;
  sellingPrice: number;
  finalSellingPrice: number;
  gst: number;
  requestQuote: boolean;
  transportation: {
    type: "per_km" | "per_unit" | "fixed" | "free";
    charge: number;
  };
  status: "active" | "inactive";
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const materialSchema = new Schema<IMaterial>(
  {
    name: {
      type: String,
      required: [true, "Material name is required"],
      trim: true,
      maxlength: [200, "Material name cannot exceed 200 characters"],
    },
    images: {
      type: [String],
      validate: {
        validator: function (v: string[]) {
          return v && v.length >= 1;
        },
        message: "At least one material image is required",
      },
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    specs: {
      type: String,
      trim: true,
      maxlength: [2000, "Specs cannot exceed 2000 characters"],
    },
    brand: {
      type: String,
      trim: true,
      maxlength: [200, "Brand name cannot exceed 200 characters"],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      default: null,
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      trim: true,
      maxlength: [50, "Unit cannot exceed 50 characters"],
    },
    minOrderQty: {
      type: Number,
      min: [0, "Minimum order quantity cannot be negative"],
      default: 1,
    },
    diameter: {
      type: String,
      trim: true,
      maxlength: [50, "Diameter cannot exceed 50 characters"],
    },
    requestQuote: {
      type: Boolean,
      default: false,
    },
    basicPrice: {
      type: Number,
      min: [0, "Basic price cannot be negative"],
      default: 0,
    },
    mrp: {
      type: Number,
      min: [0, "MRP cannot be negative"],
      default: 0,
    },
    sellingPrice: {
      type: Number,
      min: [0, "Selling price cannot be negative"],
      default: 0,
    },
    finalSellingPrice: {
      type: Number,
      min: [0, "Final selling price cannot be negative"],
      default: 0,
    },
    gst: {
      type: Number,
      min: [0, "GST cannot be negative"],
      max: [100, "GST cannot exceed 100%"],
      default: 0,
    },
    transportation: {
      type: {
        type: String,
        enum: ["per_km", "per_unit", "fixed", "free"],
        default: "free",
      },
      charge: {
        type: Number,
        min: [0, "Transportation charge cannot be negative"],
        default: 0,
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
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

// Indexes for faster queries
materialSchema.index({ category: 1, isDeleted: 1 });
materialSchema.index({ subCategory: 1, isDeleted: 1 });
materialSchema.index({ status: 1, isDeleted: 1 });
materialSchema.index({ name: "text", specs: "text", brand: "text" });
materialSchema.index({ createdAt: -1 });

const Material = mongoose.model<IMaterial>("Material", materialSchema);

export default Material;
