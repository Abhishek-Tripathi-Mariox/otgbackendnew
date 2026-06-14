import mongoose, { Document, Schema } from "mongoose";

export interface ISubCategory extends Document {
  name: string;
  image: string;
  category: mongoose.Types.ObjectId;
  status: "active" | "inactive";
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const subCategorySchema = new Schema<ISubCategory>(
  {
    name: {
      type: String,
      required: [true, "Sub category name is required"],
      trim: true,
      maxlength: [100, "Sub category name cannot exceed 100 characters"],
    },
    image: {
      type: String,
      required: [true, "Sub category image is required"],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
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
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
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

// Compound index for unique name within a category
subCategorySchema.index({ name: 1, category: 1 }, { unique: true });

// Index for faster queries
subCategorySchema.index({ category: 1, isDeleted: 1 });
subCategorySchema.index({ status: 1, isDeleted: 1 });
subCategorySchema.index({ createdAt: -1 });

const SubCategory = mongoose.model<ISubCategory>(
  "SubCategory",
  subCategorySchema,
);

export default SubCategory;
