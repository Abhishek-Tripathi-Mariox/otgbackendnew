import mongoose, { Schema, Document } from "mongoose";

// Full order-lifecycle status set. `confirmed` is kept as a LEGACY alias of
// `accepted` (older bookings carry it); both are treated as "accepted" in any
// grouping/timeline logic.
export type BookingStatus =
  | "pending"
  | "accepted"
  | "qc_pending"
  | "qc_approved"
  | "qc_rejected"
  | "packed"
  | "dispatched"
  | "in_transit"
  | "delivered"
  | "cancelled"
  // The customer's selected vendor rejected this order (Section I / Phase
  // 7) — NOT auto-reassigned or auto-cancelled per the client's explicit
  // requirement; needs admin manual resolution (reassign via the existing
  // admin vendor picker, or cancel with refund).
  | "vendor_rejected"
  | "confirmed"; // legacy alias of "accepted"

// `paymentMethod` is a free-text label chosen in the customer app (e.g. "Cash
// on Delivery", "PhonePe"); this is the one shared check for "was this a COD
// order" used by the driver cash-collection ledger. Use `COD_PAYMENT_METHOD_REGEX`
// directly in Mongo query filters, and `isCodPaymentMethod` for in-JS checks.
export const COD_PAYMENT_METHOD_REGEX = /cash\s*on\s*delivery|^cod$/i;
export const isCodPaymentMethod = (paymentMethod?: string | null): boolean =>
  COD_PAYMENT_METHOD_REGEX.test(String(paymentMethod ?? "").trim());

export const BOOKING_STATUSES: BookingStatus[] = [
  "pending",
  "accepted",
  "qc_pending",
  "qc_approved",
  "qc_rejected",
  "packed",
  "dispatched",
  "in_transit",
  "delivered",
  "cancelled",
  "vendor_rejected",
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

// Buyer/site details captured at checkout — required for both an individual
// buyer and one ordering on behalf of a company (GSTIN/PAN/company-type etc).
// Frozen on the Booking at creation time (NOT live-read from User later) so
// a subsequent profile edit never silently rewrites a past order's invoice.
export type CompanyType =
  | "Contractor"
  | "Builder"
  | "Developer"
  | "Consultant"
  | "Government"
  | "Individual";

export interface IBuyerDetails {
  accountType: "individual" | "company";
  name: string;
  mobile: string;
  email?: string;
  deliveryAddress: string;
  landmark?: string;
  city: string;
  pincode: string;
  siteContactNumber?: string;
  // Company-only
  designation?: string;
  employeeId?: string;
  companyName?: string;
  gstin?: string;
  pan?: string;
  billingAddress?: string;
  registeredOfficeAddress?: string;
  companyType?: CompanyType;
  projectName?: string;
  siteAddress?: string;
  siteContactPerson?: string;
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const MOBILE_REGEX = /^[6-9]\d{9}$/;

// Deliberately no `required: true` on any of these nested-path fields — this
// same field-map is reused for BOTH `Booking.buyerDetails` (must be fully
// filled by the time a customer checks out) AND `User.checkoutProfile` (a
// pre-fill convenience that legitimately doesn't exist for e.g. a
// brand-new/never-checked-out User doc). Mongoose enforces `required` on
// nested-path leaves independently of whether the parent object was ever
// set, which would break plain user signup if turned on here — so the
// "mandatory before payment" rule is enforced at the application layer
// instead (see validateBuyerDetails in mobileOrders.controller.ts), not the
// schema layer.
export const buyerDetailsSchemaFields = {
  accountType: { type: String, enum: ["individual", "company"] },
  name: { type: String, trim: true },
  mobile: {
    type: String,
    trim: true,
    validate: {
      validator: (v: string) => !v || MOBILE_REGEX.test(v),
      message: "Mobile number must be a valid 10-digit Indian number",
    },
  },
  email: { type: String, trim: true, lowercase: true },
  deliveryAddress: { type: String, trim: true },
  landmark: { type: String, trim: true },
  city: { type: String, trim: true },
  pincode: { type: String, trim: true },
  siteContactNumber: { type: String, trim: true },
  designation: { type: String, trim: true },
  employeeId: { type: String, trim: true },
  companyName: { type: String, trim: true },
  gstin: {
    type: String,
    trim: true,
    uppercase: true,
    validate: {
      validator: (v: string) => !v || GSTIN_REGEX.test(v),
      message: "GST number must be a valid 15-character GSTIN",
    },
  },
  pan: { type: String, trim: true, uppercase: true },
  billingAddress: { type: String, trim: true },
  registeredOfficeAddress: { type: String, trim: true },
  companyType: {
    type: String,
    enum: ["Contractor", "Builder", "Developer", "Consultant", "Government", "Individual"],
  },
  projectName: { type: String, trim: true },
  siteAddress: { type: String, trim: true },
  siteContactPerson: { type: String, trim: true },
};

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
  buyerDetails?: IBuyerDetails;
  // Set when this booking was auto-generated from an accepted bulk Quotation
  // (one Booking per quotation line item) — links back for traceability.
  quotationRef?: mongoose.Types.ObjectId;
  status: BookingStatus;
  paymentStatus: "pending" | "partial" | "completed";
  paymentMethod?: string;
  paymentGateway?: "razorpay" | "cod" | "manual";
  razorpayOrderId?: string;
  // Vendors who explicitly declined this order — excluded when the order is
  // reopened/re-notified to remaining vendors so it isn't re-offered to
  // someone who already turned it down.
  rejectedByVendors?: mongoose.Types.ObjectId[];
  // Same idea for drivers: a driver who rejects a dispatched/early-offer
  // booking is excluded when it's reopened/re-notified to remaining
  // pincode-matched drivers, so it isn't re-offered to someone who already
  // turned it down.
  rejectedByDrivers?: mongoose.Types.ObjectId[];
  // Proof-of-delivery photo captured by the driver, required before an order
  // can be marked "delivered". Who captured it is `driver` (already on this
  // document) — no separate field needed.
  podPhotoUrl?: string;
  podCapturedAt?: Date;
  notes?: string;
  deliveryDate?: Date;
  qc?: IBookingQC;
  dispatch?: IBookingDispatch;
  // Vehicle type chosen by admin for shipping this order.
  vehicleType?: "2-wheeler" | "3-wheeler" | "4-wheeler" | "6-wheeler";
  gstAmount?: number;
  discountAmount?: number;
  // Per-material "Convenience Fee" (Material.transportation) applied at
  // checkout — a flat/per-unit delivery-type charge configured by the admin
  // per product, added to totalAmount but not itself GST/discount-adjusted.
  convenienceFee?: number;
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
    // Not required at the schema level (the separate admin manual-create-
    // booking flow doesn't collect it) — the CUSTOMER checkout flow enforces
    // it via application-level validation (see validateBuyerDetails in
    // mobileOrders.controller.ts) before a Booking is ever created that way.
    buyerDetails: buyerDetailsSchemaFields,
    quotationRef: {
      type: Schema.Types.ObjectId,
      ref: "Quotation",
      default: null,
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
    paymentGateway: {
      type: String,
      enum: ["razorpay", "cod", "manual"],
    },
    razorpayOrderId: {
      type: String,
      trim: true,
      index: true,
    },
    rejectedByVendors: [
      {
        type: Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
    rejectedByDrivers: [
      {
        type: Schema.Types.ObjectId,
        ref: "Driver",
      },
    ],
    podPhotoUrl: {
      type: String,
      trim: true,
    },
    podCapturedAt: {
      type: Date,
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
    convenienceFee: {
      type: Number,
      min: [0, "Convenience fee cannot be negative"],
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
