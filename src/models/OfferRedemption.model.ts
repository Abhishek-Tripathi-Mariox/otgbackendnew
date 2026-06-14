import mongoose, { Schema, Document } from "mongoose";

export interface IOfferRedemption extends Document {
  offer: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  booking?: mongoose.Types.ObjectId | null;
  discountApplied: number;
  createdAt: Date;
}

const OfferRedemptionSchema = new Schema<IOfferRedemption>(
  {
    offer: {
      type: Schema.Types.ObjectId,
      ref: "Offer",
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    discountApplied: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

OfferRedemptionSchema.index({ offer: 1, user: 1 });

export default mongoose.model<IOfferRedemption>(
  "OfferRedemption",
  OfferRedemptionSchema,
);
