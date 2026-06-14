import mongoose, { Schema, Document } from "mongoose";

export interface IReviewReply {
  text: string;
  repliedAt: Date;
}

export interface IReviewDocument extends Document {
  material: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  reply?: IReviewReply;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema: Schema = new Schema(
  {
    material: {
      type: Schema.Types.ObjectId,
      ref: "Material",
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be between 1 and 5"],
      max: [5, "Rating must be between 1 and 5"],
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
    // Optional store/admin response to the review.
    reply: {
      text: { type: String, trim: true },
      repliedAt: { type: Date },
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

// One review per user per material — createReview upserts on this pair.
ReviewSchema.index({ material: 1, user: 1 }, { unique: true });
ReviewSchema.index({ material: 1, createdAt: -1 });

export default mongoose.model<IReviewDocument>("Review", ReviewSchema);
