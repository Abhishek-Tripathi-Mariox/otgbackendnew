import mongoose, { Document, Schema } from "mongoose";

export interface IBrand extends Document {
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

const brandSchema = new Schema<IBrand>(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
      unique: true,
      maxlength: [100, "Brand name cannot exceed 100 characters"],
    },
    image: {
      type: String,
      required: [true, "Brand image is required"],
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
brandSchema.index({ status: 1 });
brandSchema.index({ isDeleted: 1 });

// Pre-save middleware to ensure unique name (only among non-deleted)
brandSchema.pre("save", async function (next) {
  if (this.isModified("name")) {
    const existingBrand = await mongoose.models.Brand.findOne({
      name: this.name,
      isDeleted: false,
      _id: { $ne: this._id },
    });
    if (existingBrand) {
      const error = new Error("Brand with this name already exists");
      return next(error);
    }
  }
  next();
});

const Brand = mongoose.model<IBrand>("Brand", brandSchema);

export default Brand;
