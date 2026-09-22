import mongoose, { Schema, Document } from "mongoose";

export type InvoiceType = "vendor_to_customer" | "vendor_to_otg";

export interface IInvoiceDocument extends Document {
  invoiceNumber: string;
  type: InvoiceType;
  booking: mongoose.Types.ObjectId;
  // Frozen copies of the seller/buyer identity at generation time — vendor
  // business details or OTG's own company profile can change later, but an
  // already-issued invoice must keep showing what was true when it was cut.
  sellerSnapshot: Record<string, unknown>;
  buyerSnapshot: Record<string, unknown>;
  amount: number;
  // GST portion of `amount` — stored explicitly (rather than re-derived at
  // render time from Booking.gstAmount) because vendor_to_otg's amount is
  // computed from the vendor's own VendorMaterial rate, not the customer's
  // booking total, so its GST is a different figure than vendor_to_customer's.
  // Optional/undefined on invoices generated before this field existed.
  gstAmount?: number;
  generatedAt: Date;
  generatedBy: "auto" | mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema: Schema = new Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["vendor_to_customer", "vendor_to_otg"],
      required: [true, "Invoice type is required"],
    },
    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: [true, "Booking is required"],
    },
    sellerSnapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },
    buyerSnapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    gstAmount: {
      type: Number,
      min: [0, "GST amount cannot be negative"],
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    generatedBy: {
      type: Schema.Types.Mixed,
      default: "auto",
    },
  },
  {
    timestamps: true,
  },
);

// One invoice per (booking, type) — auto-generation is idempotent by design.
InvoiceSchema.index({ booking: 1, type: 1 }, { unique: true });
InvoiceSchema.index({ createdAt: -1 });

// Auto-generate a sequential number, e.g. "INV-VC-000001" (vendor->customer)
// or "INV-VO-000001" (vendor->OTG) — distinct series per type.
InvoiceSchema.pre("save", async function (next) {
  const self = this as unknown as IInvoiceDocument;
  if (self.invoiceNumber) return next();

  const prefix = self.type === "vendor_to_otg" ? "INV-VO-" : "INV-VC-";
  const last = await mongoose.models.Invoice.findOne(
    { type: self.type, invoiceNumber: { $exists: true, $ne: null } },
    { invoiceNumber: 1 },
    { sort: { invoiceNumber: -1 } },
  );
  const lastNumber = last
    ? parseInt(String(last.invoiceNumber).replace(prefix, ""), 10) || 0
    : 0;
  self.invoiceNumber = `${prefix}${String(lastNumber + 1).padStart(6, "0")}`;
  next();
});

export default mongoose.model<IInvoiceDocument>("Invoice", InvoiceSchema);
