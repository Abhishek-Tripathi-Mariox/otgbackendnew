import mongoose, { Schema, Document } from "mongoose";

export type DocumentStatus = "pending" | "approved" | "rejected";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type OnboardingStep =
  | "personal"
  | "vehicle"
  | "owner"
  | "bank"
  | "completed";

// Driver info → vehicle (incl. its docs) → vehicle's owner → bank.
// Driving license is captured during 'personal'; RC/insurance/pollution during
// 'vehicle' so each vehicle owns its own paperwork.
export const ONBOARDING_STEPS: OnboardingStep[] = [
  "personal",
  "vehicle",
  "owner",
  "bank",
  "completed",
];

export const advanceStep = (
  current: OnboardingStep,
  finished: OnboardingStep,
): OnboardingStep => {
  const next: Record<OnboardingStep, OnboardingStep> = {
    personal: "vehicle",
    vehicle: "owner",
    owner: "bank",
    bank: "completed",
    completed: "completed",
  };
  const currentIdx = ONBOARDING_STEPS.indexOf(current);
  const candidateIdx = ONBOARDING_STEPS.indexOf(next[finished]);
  return candidateIdx > currentIdx ? next[finished] : current;
};

export interface IDriverDocument {
  url?: string;
  status: DocumentStatus;
  rejectionReason?: string;
  uploadedAt?: Date;
}

export interface IDriverModel extends Document {
  name?: string;
  mobile: string;
  email?: string;
  profileImage?: string;
  dateOfBirth?: Date;

  otp?: string;
  otpExpiry?: Date;
  otpAttempts: number;

  address?: {
    street?: string;
    city?: string;
    state?: string;
    pincode?: string;
    full?: string;
    location?: {
      type: "Point";
      coordinates: [number, number];
    };
  };

  vehicles: Array<{
    _id?: mongoose.Types.ObjectId;
    brand?: string;
    model?: string;
    type?: string;
    color?: string;
    year?: string;
    liftingCapacity?: string;
    registrationNo?: string;
    insuranceNo?: string;
    insuranceExpiry?: Date;
    documents?: {
      rcBook?: IDriverDocument;
      insurance?: IDriverDocument;
      pollutionCertificate?: IDriverDocument;
    };
    createdAt?: Date;
    updatedAt?: Date;
  }>;

  owner?: {
    name?: string;
    contact?: string;
    address?: string;
  };

  bank?: {
    accountHolder?: string;
    bankName?: string;
    accountNumber?: string;
    ifsc?: string;
    branch?: string;
    passbookUrl?: string;
  };

  documents: {
    drivingLicense: IDriverDocument;
  };

  approvalStatus: ApprovalStatus;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  rejectionReason?: string;

  onboardingStep: OnboardingStep;

  status: "active" | "inactive" | "blocked";
  isVerified: boolean;

  // Driver's duty state. Only an online driver can act on a delivery
  // (pickup / mark delivered). Toggled from the driver app home screen.
  isOnline: boolean;
  lastOnlineAt?: Date;

  deviceInfo?: {
    deviceId?: string;
    deviceType?: string;
    fcmToken?: string;
    lastLoginAt?: Date;
  };

  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSubSchema = new Schema<IDriverDocument>(
  {
    url: { type: String, trim: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, trim: true },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const DriverSchema: Schema = new Schema(
  {
    name: { type: String, trim: true },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      unique: true,
      trim: true,
    },
    email: { type: String, lowercase: true, trim: true, sparse: true },
    profileImage: { type: String, trim: true },
    dateOfBirth: { type: Date },

    otp: { type: String, trim: true },
    otpExpiry: { type: Date },
    otpAttempts: { type: Number, default: 0 },

    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      full: { type: String, trim: true },
      location: {
        type: { type: String, enum: ["Point"] },
        coordinates: { type: [Number] },
      },
    },

    vehicles: {
      type: [
        new Schema(
          {
            brand: { type: String, trim: true },
            model: { type: String, trim: true },
            type: { type: String, trim: true },
            color: { type: String, trim: true },
            year: { type: String, trim: true },
            liftingCapacity: { type: String, trim: true },
            registrationNo: { type: String, trim: true, uppercase: true },
            insuranceNo: { type: String, trim: true },
            insuranceExpiry: { type: Date },
            documents: {
              rcBook: { type: DocumentSubSchema, default: () => ({}) },
              insurance: { type: DocumentSubSchema, default: () => ({}) },
              pollutionCertificate: {
                type: DocumentSubSchema,
                default: () => ({}),
              },
            },
          },
          { timestamps: true },
        ),
      ],
      default: [],
    },

    owner: {
      name: { type: String, trim: true },
      contact: { type: String, trim: true },
      address: { type: String, trim: true },
    },

    bank: {
      accountHolder: { type: String, trim: true },
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
      branch: { type: String, trim: true },
      passbookUrl: { type: String, trim: true },
    },

    documents: {
      drivingLicense: { type: DocumentSubSchema, default: () => ({}) },
    },

    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true },

    onboardingStep: {
      type: String,
      enum: ["personal", "vehicle", "owner", "bank", "completed"],
      default: "personal",
    },

    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },
    isVerified: { type: Boolean, default: false },

    isOnline: { type: Boolean, default: false },
    lastOnlineAt: { type: Date, default: null },

    deviceInfo: {
      deviceId: { type: String, trim: true },
      deviceType: { type: String, enum: ["android", "ios", "web"] },
      fcmToken: { type: String, trim: true },
      lastLoginAt: { type: Date },
    },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

DriverSchema.index({ status: 1, isDeleted: 1 });
DriverSchema.index({ approvalStatus: 1, isDeleted: 1 });
DriverSchema.index({ mobile: 1, isDeleted: 1 });
DriverSchema.index({ "address.city": 1, isDeleted: 1 });
DriverSchema.index({ "address.state": 1, isDeleted: 1 });
DriverSchema.index({ createdAt: -1 });
DriverSchema.index({ "address.location": "2dsphere" });
DriverSchema.index({
  name: "text",
  mobile: "text",
  email: "text",
  "vehicles.registrationNo": "text",
});

// The 2dsphere index on `address.location` rejects any document where the field
// is present but holds invalid geometry. When a driver saves an address without
// coordinates (e.g. the onboarding "Driver Details" step sends only a text
// address), Mongoose auto-creates an empty `location` subdocument with no
// coordinates, and the save fails with a "location ... not valid" geo error —
// which blocked drivers from advancing past the registration screen. A 2dsphere
// index happily allows documents that simply omit the field, so strip an
// empty/invalid location before every save.
DriverSchema.pre("save", function (next) {
  const loc = (this as any).address?.location;
  if (loc && (!Array.isArray(loc.coordinates) || loc.coordinates.length !== 2)) {
    (this as any).address.location = undefined;
  }
  next();
});

export default mongoose.model<IDriverModel>("Driver", DriverSchema);
