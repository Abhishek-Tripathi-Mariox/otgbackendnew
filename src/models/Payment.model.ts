import mongoose, { Schema, Document } from "mongoose";

export type PaymentStatus =
  | "created"
  | "attempted"
  | "paid"
  | "failed"
  | "refunded";

export interface IPaymentAttempt {
  at: Date;
  event: string;
  payload?: Record<string, unknown>;
}

export interface IPaymentDocument extends Document {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  bookings: mongoose.Types.ObjectId[];
  user: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  status: PaymentStatus;
  attempts: IPaymentAttempt[];
  failureReason?: string;
  // Snapshot of the cart payload at the moment the Razorpay order was
  // created (items/paymentMethod/site/notes/couponCode/pincode/gstAmounts).
  // Bookings are created from THIS snapshot, not from whatever the client
  // resends later — so the webhook can finalize an order even if the
  // client-side verify call never arrives (app closed mid-payment), and a
  // tampered client can't change the cart between order-creation and verify.
  cartSnapshot?: Record<string, unknown>;
  // Atomic claim flag: the client-side /verify call and the Razorpay webhook
  // can both try to finalize the same payment within milliseconds of each
  // other. Only one caller may flip this false->true (via a single
  // findOneAndUpdate), so only one of them actually creates the Booking(s).
  bookingsClaimed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
  {
    razorpayOrderId: {
      type: String,
      required: [true, "Razorpay order id is required"],
      unique: true,
      trim: true,
    },
    razorpayPaymentId: {
      type: String,
      trim: true,
    },
    razorpaySignature: {
      type: String,
      trim: true,
    },
    bookings: [
      {
        type: Schema.Types.ObjectId,
        ref: "Booking",
      },
    ],
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: {
      type: String,
      default: "INR",
      trim: true,
    },
    status: {
      type: String,
      enum: ["created", "attempted", "paid", "failed", "refunded"],
      default: "created",
    },
    attempts: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            event: { type: String, required: true },
            payload: { type: Schema.Types.Mixed },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    failureReason: {
      type: String,
      trim: true,
    },
    cartSnapshot: {
      type: Schema.Types.Mixed,
    },
    bookingsClaimed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

PaymentSchema.index({ user: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IPaymentDocument>("Payment", PaymentSchema);
