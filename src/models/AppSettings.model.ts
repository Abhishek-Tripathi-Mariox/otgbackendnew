import mongoose, { Schema, Document } from "mongoose";

export interface IAppSettingsDocument extends Document {
  // Singleton key — always "default"
  key: "default";
  // Editable text for the home-screen "Get Bulk Quote" promo banner
  bulkBanner: {
    title: string;
    subtitle: string;
    buttonText: string;
  };
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AppSettingsSchema: Schema = new Schema(
  {
    key: {
      type: String,
      enum: ["default"],
      default: "default",
      unique: true,
      index: true,
    },
    bulkBanner: {
      title: {
        type: String,
        trim: true,
        default: "Save Up to ₹15000 on Bulk Orders",
      },
      subtitle: {
        type: String,
        trim: true,
        default: "Buy More, Save More on Your Projects",
      },
      buttonText: {
        type: String,
        trim: true,
        default: "Get Bulk Quote",
      },
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.model<IAppSettingsDocument>(
  "AppSettings",
  AppSettingsSchema,
);
