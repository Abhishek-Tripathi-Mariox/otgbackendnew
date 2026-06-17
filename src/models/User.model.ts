import mongoose, { Schema, Document } from "mongoose";

export interface IUserDocument extends Document {
  name?: string;
  mobile: string;
  email?: string;
  profileImage?: string;
  otp?: string;
  otpExpiry?: Date;
  otpAttempts: number;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    pincode?: string;
    location?: {
      type: "Point";
      coordinates: [number, number];
    };
  };
  addresses?: Array<{
    _id?: mongoose.Types.ObjectId;
    label?: string;
    line?: string;
    lat?: number;
    lng?: number;
    isDefault?: boolean;
  }>;
  status: "active" | "inactive" | "blocked";
  isVerified: boolean;
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

const UserSchema: Schema = new Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    profileImage: {
      type: String,
      trim: true,
    },
    otp: {
      type: String,
      trim: true,
    },
    otpExpiry: {
      type: Date,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    address: {
      street: {
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
      location: {
        type: {
          type: String,
          enum: ["Point"],
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
        },
      },
    },
    // Customer's saved delivery addresses (address book). Subdocs get _id
    // automatically so individual entries can be updated/deleted by id.
    addresses: {
      type: [
        new Schema({
          label: { type: String, trim: true },
          line: { type: String, trim: true },
          lat: { type: Number },
          lng: { type: Number },
          isDefault: { type: Boolean, default: false },
        }),
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    deviceInfo: {
      deviceId: {
        type: String,
        trim: true,
      },
      deviceType: {
        type: String,
        enum: ["android", "ios", "web"],
      },
      fcmToken: {
        type: String,
        trim: true,
      },
      lastLoginAt: {
        type: Date,
      },
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

// Indexes
UserSchema.index({ status: 1, isDeleted: 1 });
UserSchema.index({ mobile: 1, isDeleted: 1 });
UserSchema.index({ "address.city": 1, isDeleted: 1 });
UserSchema.index({ "address.state": 1, isDeleted: 1 });
UserSchema.index({ isVerified: 1, isDeleted: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ "address.location": "2dsphere" });

// Text index for search
UserSchema.index({
  name: "text",
  mobile: "text",
  email: "text",
  "address.city": "text",
});

export default mongoose.model<IUserDocument>("User", UserSchema);
