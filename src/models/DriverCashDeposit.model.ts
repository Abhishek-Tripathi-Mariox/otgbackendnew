import mongoose, { Document, Schema } from "mongoose";

// A driver self-logged record of COD cash handed over to the OTG office.
// Reduces the driver's running cash-in-hand balance immediately (no admin
// approval step — see driverCash.controller.ts for the reconciliation math).
export interface IDriverCashDeposit extends Document {
  driver: mongoose.Types.ObjectId;
  amount: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const driverCashDepositSchema = new Schema<IDriverCashDeposit>(
  {
    driver: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, "Deposit amount is required"],
      min: [0.01, "Deposit amount must be greater than 0"],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [200, "Note cannot exceed 200 characters"],
    },
  },
  { timestamps: true },
);

driverCashDepositSchema.index({ driver: 1, createdAt: -1 });

const DriverCashDeposit = mongoose.model<IDriverCashDeposit>(
  "DriverCashDeposit",
  driverCashDepositSchema,
);
export default DriverCashDeposit;
