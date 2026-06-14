import mongoose, { Schema, Document } from "mongoose";

export interface IBookingDocument extends Document {
  bookingId: string;
  user: mongoose.Types.ObjectId;
  vendor?: mongoose.Types.ObjectId | null;
  material: mongoose.Types.ObjectId;
  driver?: mongoose.Types.ObjectId;
  driverFee?: number;
  driverRejectedAt?: Date;
  quantity: number;
  unit: string;
  price: number;
  totalAmount: number;
  site?: string;
  status: "pending" | "confirmed" | "in_transit" | "delivered" | "cancelled";
  paymentStatus: "pending" | "partial" | "completed";
  paymentMethod?: string;
  notes?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema: Schema = new Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    vendor: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    material: {
      type: Schema.Types.ObjectId,
      ref: "Material",
      required: [true, "Material is required"],
    },
    driver: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
    },
    driverFee: {
      type: Number,
      min: [0, "Driver fee cannot be negative"],
      default: 0,
    },
    driverRejectedAt: {
      type: Date,
      default: null,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
    },
    site: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "in_transit", "delivered", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "partial", "completed"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
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
      ref: "User",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
BookingSchema.index({ user: 1, createdAt: -1 });
BookingSchema.index({ vendor: 1, createdAt: -1 });
BookingSchema.index({ driver: 1, createdAt: -1 });
BookingSchema.index({ driver: 1, status: 1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ paymentStatus: 1 });
BookingSchema.index({ createdAt: -1 });

export default mongoose.model<IBookingDocument>("Booking", BookingSchema);
