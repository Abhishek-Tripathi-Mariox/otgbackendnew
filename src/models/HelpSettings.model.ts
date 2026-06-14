import mongoose, { Schema, Document } from "mongoose";

export interface IHelpSettingsDocument extends Document {
  // Singleton key — always "default"
  key: "default";
  address?: string;
  mobile?: string;
  email?: string;
  whatsappNumber?: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HelpSettingsSchema: Schema = new Schema(
  {
    key: {
      type: String,
      enum: ["default"],
      default: "default",
      unique: true,
      index: true,
    },
    address: { type: String, trim: true },
    mobile: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    whatsappNumber: { type: String, trim: true },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.model<IHelpSettingsDocument>(
  "HelpSettings",
  HelpSettingsSchema,
);
