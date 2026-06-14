import mongoose, { Schema, Document } from "mongoose";

export type TransactionStatus =
  | "pending"
  | "processing"
  | "settled"
  | "failed";

export type TransactionType = "payment" | "refund" | "settlement";

export type TransactionMode =
  | "upi"
  | "bank_transfer"
  | "neft"
  | "rtgs"
  | "cash"
  | "card"
  | "wallet"
  | "other";

export interface ITransactionDocument extends Document {
  transactionCode: string;
  reference?: string;
  booking?: mongoose.Types.ObjectId;
  user?: mongoose.Types.ObjectId;
  vendor?: mongoose.Types.ObjectId;
  material?: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  mode: TransactionMode;
  type: TransactionType;
  status: TransactionStatus;
  description?: string;
  failureReason?: string;
  meta?: Record<string, unknown>;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema: Schema = new Schema(
  {
    transactionCode: { type: String, trim: true, unique: true },
    reference: { type: String, trim: true },
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    vendor: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },
    material: {
      type: Schema.Types.ObjectId,
      ref: "Material",
      default: null,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: { type: String, default: "INR", trim: true },
    mode: {
      type: String,
      enum: [
        "upi",
        "bank_transfer",
        "neft",
        "rtgs",
        "cash",
        "card",
        "wallet",
        "other",
      ],
      default: "other",
      index: true,
    },
    type: {
      type: String,
      enum: ["payment", "refund", "settlement"],
      default: "payment",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "settled", "failed"],
      default: "pending",
      index: true,
    },
    description: { type: String, trim: true },
    failureReason: { type: String, trim: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

TransactionSchema.index({ status: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, createdAt: -1 });
TransactionSchema.index({ createdAt: -1 });

// Auto-generate code: TXN-000001
TransactionSchema.pre("save", async function (next) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self: any = this;
  if (!self.transactionCode) {
    const last = await mongoose.models.Transaction.findOne(
      { transactionCode: { $exists: true, $ne: null } },
      { transactionCode: 1 },
      { sort: { transactionCode: -1 } },
    );
    const lastNumber = last
      ? parseInt(String(last.transactionCode).replace("TXN-", ""), 10) || 0
      : 0;
    self.transactionCode = `TXN-${String(lastNumber + 1).padStart(6, "0")}`;
  }
  next();
});

export default mongoose.model<ITransactionDocument>(
  "Transaction",
  TransactionSchema,
);
