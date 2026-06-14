import mongoose, { Document, Schema } from "mongoose";

export interface ICategory extends Document {
  name: string;
  image: string;
  status: "active" | "inactive";
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      unique: true,
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },
    image: {
      type: String,
      required: [true, "Category image is required"],
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

// Index for faster queries
categorySchema.index({ status: 1 });
categorySchema.index({ isDeleted: 1 });

// Pre-save middleware to ensure unique name (only among non-deleted)
categorySchema.pre("save", async function (next) {
  if (this.isModified("name")) {
    const existingCategory = await mongoose.models.Category.findOne({
      name: this.name,
      isDeleted: false,
      _id: { $ne: this._id },
    });
    if (existingCategory) {
      const error = new Error("Category with this name already exists");
      return next(error);
    }
  }
  next();
});

const Category = mongoose.model<ICategory>("Category", categorySchema);

export default Category;
