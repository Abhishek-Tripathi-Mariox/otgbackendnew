import mongoose, { Document, Schema } from "mongoose";

export interface IBanner extends Document {
  title: string;
  content: string;
  image: string;
  enableBulkQuote: boolean;
  order: number;
  status: "active" | "inactive";
  isDeleted: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bannerSchema = new Schema<IBanner>(
  {
    title: {
      type: String,
      trim: true,
      default: "",
    },
    content: {
      type: String,
      trim: true,
      default: "",
    },
    image: {
      type: String,
      required: [true, "Banner image is required"],
    },
    enableBulkQuote: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

bannerSchema.index({ status: 1, isDeleted: 1, order: 1 });

export default mongoose.model<IBanner>("Banner", bannerSchema);
