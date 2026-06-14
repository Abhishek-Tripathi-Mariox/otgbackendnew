import mongoose, { Schema, Document } from "mongoose";

export interface IFaqDocument extends Document {
  question: string;
  answer: string;
  // Optional category scope — when set, the FAQ is shown for materials in that
  // category; otherwise it is treated as a global FAQ shown everywhere.
  category?: mongoose.Types.ObjectId | null;
  order: number;
  status: "active" | "inactive";
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FaqSchema: Schema = new Schema(
  {
    question: {
      type: String,
      required: [true, "Question is required"],
      trim: true,
      maxlength: [300, "Question cannot exceed 300 characters"],
    },
    answer: {
      type: String,
      required: [true, "Answer is required"],
      trim: true,
      maxlength: [2000, "Answer cannot exceed 2000 characters"],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

FaqSchema.index({ status: 1, order: 1 });

export default mongoose.model<IFaqDocument>("Faq", FaqSchema);
