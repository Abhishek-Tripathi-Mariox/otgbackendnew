import mongoose, { Schema, Document } from "mongoose";

export interface ICmsPageDocument extends Document {
  slug: string;
  title: string;
  description?: string;
  body: string;
  status: "draft" | "published";
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CmsPageSchema: Schema = new Schema(
  {
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    body: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.model<ICmsPageDocument>("CmsPage", CmsPageSchema);
