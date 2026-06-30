import mongoose, { Schema, Document } from "mongoose";

export type VendorOnboardingStep =
  | "business"
  | "categories"
  | "documents"
  | "completed";

export const VENDOR_ONBOARDING_STEPS: VendorOnboardingStep[] = [
  "business",
  "categories",
  "documents",
  "completed",
];

// Advance to the step after `finished`, but never move backwards (lets a vendor
// re-save an earlier step without resetting their progress).
export const advanceVendorStep = (
  current: VendorOnboardingStep,
  finished: VendorOnboardingStep,
): VendorOnboardingStep => {
  const next: Record<VendorOnboardingStep, VendorOnboardingStep> = {
    business: "categories",
    categories: "documents",
    documents: "completed",
    completed: "completed",
  };
  const currentIdx = VENDOR_ONBOARDING_STEPS.indexOf(current);
  const candidateIdx = VENDOR_ONBOARDING_STEPS.indexOf(next[finished]);
  return candidateIdx > currentIdx ? next[finished] : current;
};

export interface IVendorDocument extends Document {
  vendorCode: string;
  name: string;
  mobile: string;
  email?: string;
  business: {
    name: string;
    type?: string;
    gstNumber?: string;
    panNumber?: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
  };
  categories: mongoose.Types.ObjectId[];
  documents?: {
    gstCertificate?: string;
    panCard?: string;
    tradeLicense?: string;
    bankCheque?: string;
  };
  onboardingStep: VendorOnboardingStep;
  bankDetails: {
    accountHolderName: string;
    accountNumber: string;
    bankName: string;
    ifscCode: string;
    branchName?: string;
  };
  location: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
    address?: string;
  };
  status: "active" | "inactive";
  isVerified: boolean;
  // Admin approval state for self-registered vendors. Admin-created vendors
  // default to "approved"; vendors who sign up via the app are "pending" until
  // an admin reviews their documents and approves/rejects.
  approvalStatus: "pending" | "approved" | "rejected";
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  rejectionReason?: string;
  addedByAdmin: boolean;
  otp?: string;
  otpExpiry?: Date;
  otpAttempts: number;
  deviceInfo?: {
    deviceId?: string;
    deviceType?: string;
    fcmToken?: string;
    lastLoginAt?: Date;
  };
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VendorSchema: Schema = new Schema(
  {
    vendorCode: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      unique: true,
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
      sparse: true, // Allows null/undefined values while maintaining uniqueness for non-null
    },
    business: {
      name: {
        type: String,
        trim: true,
      },
      type: {
        type: String,
        trim: true,
      },
      gstNumber: {
        type: String,
        trim: true,
        uppercase: true,
        validate: {
          validator: function (v: string) {
            if (!v) return true; // optional field
            return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
              v,
            );
          },
          message: "GST number must be a valid 15-character GSTIN",
        },
      },
      panNumber: {
        type: String,
        trim: true,
      },
      address: {
        type: String,
        trim: true,
      },
      city: {
        type: String,
        trim: true,
      },
      state: {
        type: String,
        trim: true,
      },
      pincode: {
        type: String,
        trim: true,
      },
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        validate: {
          validator: function (v: number[]) {
            // Allow empty (vendor still onboarding); validate only when set.
            if (!v || v.length === 0) return true;
            return (
              v.length === 2 &&
              v[0] >= -180 &&
              v[0] <= 180 && // longitude
              v[1] >= -90 &&
              v[1] <= 90 // latitude
            );
          },
          message: "Invalid coordinates. Must be [longitude, latitude]",
        },
      },
      address: {
        type: String,
        trim: true,
      },
    },
    bankDetails: {
      accountHolderName: {
        type: String,
        trim: true,
      },
      accountNumber: {
        type: String,
        trim: true,
      },
      bankName: {
        type: String,
        trim: true,
      },
      ifscCode: {
        type: String,
        trim: true,
        uppercase: true,
        validate: {
          validator: function (v: string) {
            if (!v) return true; // optional during onboarding
            return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v);
          },
          message: "IFSC code must be a valid 11-character code",
        },
      },
      branchName: {
        type: String,
        trim: true,
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    addedByAdmin: {
      type: Boolean,
      default: true,
    },
    categories: [
      {
        type: Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    documents: {
      gstCertificate: { type: String, trim: true },
      panCard: { type: String, trim: true },
      tradeLicense: { type: String, trim: true },
      bankCheque: { type: String, trim: true },
    },
    // Defaults to "completed" so existing/admin-created vendors (which never had
    // this field) are treated as fully onboarded. Self-registered vendors are
    // explicitly created at "business" in the send-otp controller.
    onboardingStep: {
      type: String,
      enum: ["business", "categories", "documents", "completed"],
      default: "completed",
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    deviceInfo: {
      deviceId: { type: String, trim: true },
      deviceType: { type: String, trim: true },
      fcmToken: { type: String, trim: true },
      lastLoginAt: { type: Date },
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

// Create 2dsphere index for geospatial queries
VendorSchema.index({ location: "2dsphere" });

// Auto-generate vendor code before saving
VendorSchema.pre("save", async function (next) {
  if (!this.vendorCode) {
    const lastVendor = await mongoose.models.Vendor.findOne(
      { vendorCode: { $exists: true, $ne: null } },
      { vendorCode: 1 },
      { sort: { vendorCode: -1 } },
    );
    const lastNumber = lastVendor
      ? parseInt(lastVendor.vendorCode.replace("VND-", ""), 10)
      : 0;
    this.vendorCode = `VND-${String(lastNumber + 1).padStart(5, "0")}`;
  }
  next();
});

// Compound indexes for common queries
VendorSchema.index({ status: 1, isDeleted: 1 });
VendorSchema.index({ mobile: 1, isDeleted: 1 });
VendorSchema.index({ "business.city": 1, isDeleted: 1 });
VendorSchema.index({ createdAt: -1 });

// Text index for search
VendorSchema.index({
  name: "text",
  "business.name": "text",
  "business.address": "text",
  "business.city": "text",
});

export default mongoose.model<IVendorDocument>("Vendor", VendorSchema);
