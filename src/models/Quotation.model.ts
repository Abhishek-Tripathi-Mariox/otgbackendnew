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

  // Admin response (overall)
  status: "new" | "quoted" | "accepted" | "rejected" | "expired";
  quotedPrice?: number;
  quotedCurrency?: string;
  quotedValidTill?: Date;
  adminNotes?: string;
  respondedBy?: mongoose.Types.ObjectId;
  respondedAt?: Date;

  // Vendor allocation (admin assigns; assigned vendor sees the request)
  assignedVendor?: mongoose.Types.ObjectId | null;
  assignedAt?: Date | null;
  assignedBy?: mongoose.Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

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
      enum: ["new", "quoted", "accepted", "rejected", "expired"],
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
