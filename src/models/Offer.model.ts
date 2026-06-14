import mongoose, { Schema, Document } from "mongoose";

export type OfferScope =
  | "all"
  | "category"
  | "subCategory"
  | "material"
  | "user";

export type DiscountType =
  | "percentage"
  | "flat"
  | "free_delivery"
  | "bogo";

export interface IOfferDocument extends Document {
  code: string; // uppercase coupon code, unique
  title: string;
  description?: string;

  /** What the offer applies to */
  scope: OfferScope;
  categories?: mongoose.Types.ObjectId[];
  subCategories?: mongoose.Types.ObjectId[];
  materials?: mongoose.Types.ObjectId[];
  users?: mongoose.Types.ObjectId[];

  /** How the discount is calculated */
  discountType: DiscountType;
  discountValue: number; // % for percentage, ₹ for flat. Ignored for free_delivery.
  maxDiscount?: number | null; // cap for percentage offers (₹)
  /** BOGO: customer buys X qualifying units, gets Y free of the cheapest */
  buyX?: number | null;
  getY?: number | null;

  /** When the offer is valid */
  startsAt?: Date | null;
  endsAt?: Date | null;

  /** Constraints */
  minOrderAmount?: number | null;
  maxUsesPerUser?: number | null;
  globalUsageLimit?: number | null;
  usageCount: number; // running tally of redemptions

  /** Redemption mode */
  autoApply: boolean; // if true, applies without entering the code
  stackable: boolean; // if true, can be combined with other offers

  status: "active" | "inactive";
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OfferSchema = new Schema<IOfferDocument>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },

    scope: {
      type: String,
      enum: ["all", "category", "subCategory", "material", "user"],
      default: "all",
      required: true,
    },
    categories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    subCategories: [{ type: Schema.Types.ObjectId, ref: "SubCategory" }],
    materials: [{ type: Schema.Types.ObjectId, ref: "Material" }],
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],

    discountType: {
      type: String,
      enum: ["percentage", "flat", "free_delivery", "bogo"],
      required: true,
    },
    discountValue: { type: Number, default: 0, min: 0 },
    maxDiscount: { type: Number, default: null },
    buyX: { type: Number, default: null },
    getY: { type: Number, default: null },

    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    minOrderAmount: { type: Number, default: null },
    maxUsesPerUser: { type: Number, default: null },
    globalUsageLimit: { type: Number, default: null },
    usageCount: { type: Number, default: 0 },

    autoApply: { type: Boolean, default: false },
    stackable: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

OfferSchema.index({ status: 1, endsAt: 1 });

export default mongoose.model<IOfferDocument>("Offer", OfferSchema);
