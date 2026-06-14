import mongoose, { Schema, Document } from "mongoose";

export interface ISupportTicketReply {
  by: "admin" | "customer";
  message: string;
  authorId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface ISupportTicketDocument extends Document {
  ticketCode: string;
  user?: mongoose.Types.ObjectId;
  vendor?: mongoose.Types.ObjectId;
  source?: "customer" | "vendor";
  issueType?: string;
  name: string;
  mobile: string;
  email?: string;
  message: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  replies: ISupportTicketReply[];
  assignedTo?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketSchema: Schema = new Schema(
  {
    ticketCode: { type: String, trim: true },
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
    source: {
      type: String,
      enum: ["customer", "vendor"],
      default: "customer",
      index: true,
    },
    issueType: {
      type: String,
      trim: true,
      default: "",
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
          return /^[6-9]\d{9}$/.test(
            String(v || "").replace(/^\+91/, "").replace(/\s+/g, ""),
          );
        },
        message: "Mobile number must be a valid 10-digit Indian number",
      },
    },
    email: { type: String, lowercase: true, trim: true },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
      index: true,
    },
    replies: {
      type: [
        new Schema(
          {
            by: {
              type: String,
              enum: ["admin", "customer"],
              required: true,
            },
            message: { type: String, required: true, trim: true },
            authorId: { type: Schema.Types.ObjectId, default: null },
          },
          { timestamps: { createdAt: true, updatedAt: false } },
        ),
      ],
      default: [],
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

SupportTicketSchema.index({ status: 1, createdAt: -1 });
SupportTicketSchema.index({ mobile: 1, createdAt: -1 });

// Auto-generate ticket code: TKT-00001
SupportTicketSchema.pre("save", async function (next) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self: any = this;
  if (!self.ticketCode) {
    const last = await mongoose.models.SupportTicket.findOne(
      { ticketCode: { $exists: true, $ne: null } },
      { ticketCode: 1 },
      { sort: { ticketCode: -1 } },
    );
    const lastNumber = last
      ? parseInt(String(last.ticketCode).replace("TKT-", ""), 10) || 0
      : 0;
    self.ticketCode = `TKT-${String(lastNumber + 1).padStart(5, "0")}`;
  }
  next();
});

export default mongoose.model<ISupportTicketDocument>(
  "SupportTicket",
  SupportTicketSchema,
);
