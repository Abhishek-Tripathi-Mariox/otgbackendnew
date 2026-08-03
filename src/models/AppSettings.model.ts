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
  // OTG's own legal-entity details — used as the "buyer" party on the
  // vendor->OTG back-to-back invoice.
  companyProfile: {
    name: string;
    gstin: string;
    pan: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    bankAccountNumber: string;
    bankIfsc: string;
    bankName: string;
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
    companyProfile: {
      name: { type: String, trim: true, default: "OTG" },
      gstin: { type: String, trim: true, default: "" },
      pan: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      pincode: { type: String, trim: true, default: "" },
      bankAccountNumber: { type: String, trim: true, default: "" },
      bankIfsc: { type: String, trim: true, default: "" },
      bankName: { type: String, trim: true, default: "" },
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
