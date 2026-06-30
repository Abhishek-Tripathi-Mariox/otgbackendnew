import mongoose, { Schema, Document } from "mongoose";

// Full order-lifecycle status set. `confirmed` is kept as a LEGACY alias of
// `accepted` (older bookings carry it); both are treated as "accepted" in any
// grouping/timeline logic.
export type BookingStatus =
  | "pending"
  | "accepted"
  | "qc_pending"
  | "qc_approved"
  | "packed"
  | "dispatched"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "confirmed"; // legacy alias of "accepted"

export const BOOKING_STATUSES: BookingStatus[] = [
  "pending",
  "accepted",
  "qc_pending",
  "qc_approved",
  "packed",
  "dispatched",
  "in_transit",
  "delivered",
  "cancelled",
  "confirmed",
];

export interface IBookingQC {
  submittedAt: Date;
  materialPhotos: string[];
  packagingPhotos: string[];
  note?: string;
}

export interface IBookingDispatch {
  dispatchedAt: Date;
  dispatchDate?: Date;
  dispatchTime?: string;
  vehicleNumber?: string;
  driverName?: string;
}

export interface IBookingStatusHistory {
  status: string;
  at: Date;
  note?: string;
}

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
  pincode?: string;
  status: BookingStatus;
  paymentStatus: "pending" | "partial" | "completed";
  paymentMethod?: string;
  notes?: string;
  deliveryDate?: Date;
  qc?: IBookingQC;
  dispatch?: IBookingDispatch;
  // Vehicle type chosen by admin for shipping this order.
  vehicleType?: "2-wheeler" | "3-wheeler" | "4-wheeler" | "6-wheeler";
  gstAmount?: number;
  discountAmount?: number;
  statusHistory?: IBookingStatusHistory[];
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
    // Delivery pincode — used to match unassigned orders to vendors whose
    // business pincode is the same (claim/first-come-first-serve allocation).
    pincode: {
      type: String,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
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
    deliveryDate: {
      type: Date,
      default: null,
    },
    qc: {
      submittedAt: { type: Date },
      materialPhotos: { type: [String], default: [] },
      packagingPhotos: { type: [String], default: [] },
      note: { type: String, trim: true },
    },
    dispatch: {
      dispatchedAt: { type: Date },
      dispatchDate: { type: Date },
      dispatchTime: { type: String, trim: true },
      vehicleNumber: { type: String, trim: true },
      driverName: { type: String, trim: true },
    },
    vehicleType: {
      type: String,
      enum: ["2-wheeler", "3-wheeler", "4-wheeler", "6-wheeler"],
    },
    gstAmount: {
      type: Number,
      min: [0, "GST amount cannot be negative"],
      default: 0,
    },
    discountAmount: {
      type: Number,
      min: [0, "Discount amount cannot be negative"],
      default: 0,
    },
    statusHistory: {
      type: [
        new Schema(
          {
            status: { type: String, required: true },
            at: { type: Date, required: true },
            note: { type: String, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
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

/**
 * Apply a status transition to a booking: set the new status, append an entry
 * to `statusHistory`, and stamp lifecycle timestamps (e.g. `deliveryDate` on
 * delivery). This is the single source of truth for status changes — every
 * vendor/driver transition should go through it so the customer tracking
 * timeline stays consistent. Does NOT save; the caller persists.
 */
export const pushStatus = (
  booking: IBookingDocument,
  status: BookingStatus,
  note?: string,
): void => {
  booking.status = status;
  if (!Array.isArray(booking.statusHistory)) booking.statusHistory = [];
  booking.statusHistory.push({ status, at: new Date(), note });
  if (status === "delivered" && !booking.deliveryDate) {
    booking.deliveryDate = new Date();
  }
};

export default mongoose.model<IBookingDocument>("Booking", BookingSchema);
