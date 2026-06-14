import mongoose, { Document, Schema } from "mongoose";
import { encrypt, decrypt } from "../utils/encryption";

export interface IConfigField {
  key: string;
  value: string; // stored encrypted
  label: string;
}

export interface IConfig extends Document {
  service: string;
  label: string;
  fields: IConfigField[];
  isActive: boolean;
  updatedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const configFieldSchema = new Schema(
  {
    key: {
      type: String,
      required: [true, "Field key is required"],
      trim: true,
    },
    value: {
      type: String,
      default: "",
    },
    label: {
      type: String,
      required: [true, "Field label is required"],
      trim: true,
    },
  },
  { _id: false },
);

const configSchema = new Schema<IConfig>(
  {
    service: {
      type: String,
      required: [true, "Service name is required"],
      unique: true,
      trim: true,
      enum: ["google-api", "firebase", "razorpay", "sms"],
    },
    label: {
      type: String,
      required: [true, "Service label is required"],
      trim: true,
    },
    fields: {
      type: [configFieldSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

// Encrypt field values before saving
configSchema.pre("save", function (next) {
  if (this.isModified("fields")) {
    this.fields = this.fields.map((field) => {
      if (field.value && !field.value.startsWith("ENC:")) {
        return {
          ...field,
          key: field.key,
          label: field.label,
          value: "ENC:" + encrypt(field.value),
        };
      }
      return field;
    });
  }
  next();
});

// Decrypt field values when converting to JSON
configSchema.methods.getDecryptedFields = function (): IConfigField[] {
  return this.fields.map((field: IConfigField) => {
    if (field.value && field.value.startsWith("ENC:")) {
      return {
        key: field.key,
        label: field.label,
        value: decrypt(field.value.substring(4)),
      };
    }
    return field;
  });
};

// Mask values for listing (only show last 4 chars)
configSchema.methods.getMaskedFields = function (): IConfigField[] {
  return this.fields.map((field: IConfigField) => {
    if (field.value && field.value.startsWith("ENC:")) {
      try {
        const decrypted = decrypt(field.value.substring(4));
        const masked =
          decrypted.length > 4
            ? "••••••••" + decrypted.slice(-4)
            : "••••••••";
        return { key: field.key, label: field.label, value: masked };
      } catch {
        return { key: field.key, label: field.label, value: "••••••••" };
      }
    }
    return field;
  });
};

const Config = mongoose.model<IConfig>("Config", configSchema);
export default Config;
