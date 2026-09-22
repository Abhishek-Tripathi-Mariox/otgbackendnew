import mongoose, { Schema, Document } from "mongoose";

export interface IQuotationItem {
  categoryId?: mongoose.Types.ObjectId | string;
  categoryName?: string;
  subCategoryId?: mongoose.Types.ObjectId | string;
  subCategoryName?: string;
  materialId?: mongoose.Types.ObjectId | string;
  materialName?: string;
  quantity?: string;
  unit?: string;
  note?: string;
  quotedPrice?: number;
}

// One snapshot of a prior quote — pushed onto quoteHistory right before
// respondToQuotation overwrites the live quotedPrice/quotedValidTill/
// adminNotes fields, so every revision is preserved with its own timestamp
// instead of being silently destroyed.
export interface IQuoteHistoryEntry {
  quotedPrice?: number | null;
  quotedValidTill?: Date | null;
  adminNotes?: string;
  respondedBy?: mongoose.Types.ObjectId | null;
  respondedAt?: Date | null;
}

export interface IQuotationDocument extends Document {
  quotationCode: string;
  user?: mongoose.Types.ObjectId;

  // Customer-supplied info (also used for guest requests)
  customerType: "contractor" | "individual";
  name: string;
  mobile: string;
  email?: string;
  company?: string;
  address?: string;
  landmark?: string;

  // Itemised request (new format)
  items: IQuotationItem[];

  // Legacy flat fields (kept for older clients/backfill — optional)
  category?: string;
  quantity?: string;
  unit?: string;
  materialRequirement?: string;

  // Admin response (overall). "procurement" = customer has accepted and the
  // order has moved to backend/procurement handling (set instead of just
  // "accepted" when setMyQuotationStatus processes an acceptance).
  status:
    | "new"
    | "quoted"
    | "accepted"
    | "procurement"
    | "rejected"
    | "expired";
  quotedPrice?: number;
  quotedCurrency?: string;
  quotedValidTill?: Date;
  adminNotes?: string;
  respondedBy?: mongoose.Types.ObjectId;
  respondedAt?: Date;
  // Every PRIOR quote revision, oldest first — see respondToQuotation. The
  // live quotedPrice/quotedValidTill/adminNotes/respondedBy/respondedAt
  // fields above always hold the CURRENT (latest) quote.
  quoteHistory?: IQuoteHistoryEntry[];

  // Customer's own uploaded RFQ/specification PDF, set once at createQuotation
  // time. Deliberately a SEPARATE slot from otgQuotationPdf below — admin's
  // formal quote-back document used to overwrite (and S3-delete) whatever
  // was here, destroying the customer's original file. Never written to by
  // uploadQuotationPdf.
  quotationPdf?: {
    url: string;
    name?: string;
    uploadedAt?: Date;
  } | null;

  // Admin's formal quotation document sent back to the customer, set by
  // uploadQuotationPdf. Independent of quotationPdf (the customer's own
  // upload) — the two must never share a slot.
  otgQuotationPdf?: {
    url: string;
    name?: string;
    uploadedAt?: Date;
  } | null;

  // Vendor allocation (admin assigns; assigned vendor sees the request)
  assignedVendor?: mongoose.Types.ObjectId | null;
  assignedAt?: Date | null;
  assignedBy?: mongoose.Types.ObjectId | null;
  // The vendor's own agreed rate (set by admin alongside assignment) — this,
  // not `quotedPrice` (the customer's price), is what the vendor app shows,
  // framed as a Purchase Order. `vendorPoStatus` tracks the vendor's own
  // accept action on it, independent of the customer's accept/reject on
  // `status`.
  vendorRate?: number | null;
  vendorPoStatus?: "pending" | "accepted" | null;
  vendorPoAcceptedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const pdfSubSchema = () =>
  new Schema(
    {
      url: { type: String, trim: true },
      name: { type: String, trim: true },
      uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false },
  );

const QuotationSchema: Schema = new Schema(
  {
    quotationCode: { type: String, trim: true },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    customerType: {
      type: String,
      enum: ["contractor", "individual"],
      default: "individual",
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
      validate: {
        validator: function (v: string) {
          return /^[6-9]\d{9}$/.test(v.replace(/^\+91/, "").replace(/\s/g, ""));
        },
        message: "Mobile number must be a valid 10-digit Indian number",
      },
    },
    email: { type: String, lowercase: true, trim: true },
    company: { type: String, trim: true },
    address: { type: String, trim: true },
    landmark: { type: String, trim: true },

    items: {
      type: [
        new Schema(
          {
            categoryId: {
              type: Schema.Types.ObjectId,
              ref: "Category",
              default: null,
            },
            categoryName: { type: String, trim: true },
            subCategoryId: {
              type: Schema.Types.ObjectId,
              ref: "SubCategory",
              default: null,
            },
            subCategoryName: { type: String, trim: true },
            materialId: {
              type: Schema.Types.ObjectId,
              ref: "Material",
              default: null,
            },
            materialName: { type: String, trim: true },
            quantity: { type: String, trim: true },
            unit: { type: String, trim: true },
            note: { type: String, trim: true },
            quotedPrice: { type: Number, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // Legacy flat fields (kept so old clients still work)
    category: { type: String, trim: true },
    quantity: { type: String, trim: true },
    unit: { type: String, trim: true },
    materialRequirement: { type: String, trim: true },

    status: {
      type: String,
      enum: ["new", "quoted", "accepted", "procurement", "rejected", "expired"],
      default: "new",
      index: true,
    },
    quotedPrice: { type: Number, default: null },
    quotedCurrency: { type: String, default: "INR" },
    quotedValidTill: { type: Date, default: null },
    adminNotes: { type: String, trim: true },
    respondedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    respondedAt: { type: Date, default: null },
    quoteHistory: {
      type: [
        new Schema(
          {
            quotedPrice: { type: Number, default: null },
            quotedValidTill: { type: Date, default: null },
            adminNotes: { type: String, trim: true },
            respondedBy: {
              type: Schema.Types.ObjectId,
              ref: "Admin",
              default: null,
            },
            respondedAt: { type: Date, default: null },
          },
          { _id: false, timestamps: false },
        ),
      ],
      default: [],
    },

    quotationPdf: {
      type: pdfSubSchema(),
      default: null,
    },
    otgQuotationPdf: {
      type: pdfSubSchema(),
      default: null,
    },

    assignedVendor: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    assignedAt: { type: Date, default: null },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    vendorRate: { type: Number, default: null },
    vendorPoStatus: {
      type: String,
      enum: ["pending", "accepted"],
      default: null,
    },
    vendorPoAcceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

QuotationSchema.index({ status: 1, createdAt: -1 });
QuotationSchema.index({ mobile: 1, createdAt: -1 });
QuotationSchema.index({ assignedVendor: 1, createdAt: -1 });

// Auto-generate code: QT-00001
QuotationSchema.pre("save", async function (next) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self: any = this;
  if (!self.quotationCode) {
    const last = await mongoose.models.Quotation.findOne(
      { quotationCode: { $exists: true, $ne: null } },
      { quotationCode: 1 },
      { sort: { quotationCode: -1 } },
    );
    const lastNumber = last
      ? parseInt(String(last.quotationCode).replace("QT-", ""), 10) || 0
      : 0;
    self.quotationCode = `QT-${String(lastNumber + 1).padStart(5, "0")}`;
  }
  next();
});

export default mongoose.model<IQuotationDocument>(
  "Quotation",
  QuotationSchema,
);
