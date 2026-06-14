import mongoose, { Document, Schema } from "mongoose";

export interface INotification extends Document {
  title: string;
  message: string;
  targetType: "all" | "users" | "vendors" | "drivers" | "specific";
  specificRecipients: {
    users: mongoose.Types.ObjectId[];
    vendors: mongoose.Types.ObjectId[];
    drivers: mongoose.Types.ObjectId[];
  };
  sentTo: {
    userCount: number;
    vendorCount: number;
    driverCount: number;
  };
  status: "draft" | "sent" | "failed";
  sentAt: Date | null;
  createdBy: mongoose.Types.ObjectId;
  readByVendors: mongoose.Types.ObjectId[];
  deletedByVendors: mongoose.Types.ObjectId[];
  readByDrivers: mongoose.Types.ObjectId[];
  deletedByDrivers: mongoose.Types.ObjectId[];
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    message: {
      type: String,
      required: [true, "Notification message is required"],
      trim: true,
      maxlength: [1000, "Message cannot exceed 1000 characters"],
    },
    targetType: {
      type: String,
      required: true,
      enum: ["all", "users", "vendors", "drivers", "specific"],
      default: "all",
    },
    specificRecipients: {
      users: [{ type: Schema.Types.ObjectId, ref: "User" }],
      vendors: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
      drivers: [{ type: Schema.Types.ObjectId, ref: "Driver" }],
    },
    sentTo: {
      userCount: { type: Number, default: 0 },
      vendorCount: { type: Number, default: 0 },
      driverCount: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["draft", "sent", "failed"],
      default: "sent",
    },
    sentAt: { type: Date, default: null },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    readByVendors: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
    deletedByVendors: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
    readByDrivers: [{ type: Schema.Types.ObjectId, ref: "Driver" }],
    deletedByDrivers: [{ type: Schema.Types.ObjectId, ref: "Driver" }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ status: 1 });
notificationSchema.index({ targetType: 1 });
notificationSchema.index({ isDeleted: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ readByVendors: 1 });
notificationSchema.index({ deletedByVendors: 1 });
notificationSchema.index({ "specificRecipients.vendors": 1 });
notificationSchema.index({ readByDrivers: 1 });
notificationSchema.index({ deletedByDrivers: 1 });
notificationSchema.index({ "specificRecipients.drivers": 1 });

const Notification = mongoose.model<INotification>(
  "Notification",
  notificationSchema,
);
export default Notification;
