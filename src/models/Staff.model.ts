import mongoose, { Schema, Document, Types } from "mongoose";

export interface IStaffDocument extends Document {
  staffId: string;
  name: string;
  email: string;
  mobile: string;
  password: string;
  role: string;
  roleId: Types.ObjectId | null;
  department: string;
  status: "active" | "inactive" | "blocked";
  lastLogin: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const StaffSchema: Schema = new Schema(
  {
    staffId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      required: [true, "Role is required"],
      trim: true,
    },
    roleId: {
      type: Schema.Types.ObjectId,
      ref: "Role",
      default: null,
      index: true,
    },
    department: {
      type: String,
      required: [true, "Department is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Auto-generate staffId before saving
StaffSchema.pre("save", async function (next) {
  if (!this.staffId) {
    const lastStaff = await mongoose
      .model("Staff")
      .findOne({ staffId: { $regex: /^STF-/ } })
      .sort({ staffId: -1 })
      .select("staffId");

    let nextNum = 1;
    if (lastStaff && lastStaff.staffId) {
      const lastNum = parseInt(lastStaff.staffId.replace("STF-", ""), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    this.staffId = `STF-${String(nextNum).padStart(3, "0")}`;
  }
  next();
});

export default mongoose.model<IStaffDocument>("Staff", StaffSchema);
