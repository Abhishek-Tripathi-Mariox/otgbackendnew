import mongoose, { Schema, Document } from "mongoose";

export const RBAC_MODULES = [
  "dashboard",
  "users",
  "vendors",
  "drivers",
  "materials",
  "categories",
  "subCategories",
  "bookings",
  "transactions",
  "staff",
  "roles",
  "cms",
  "notifications",
  "banners",
  "offers",
  "reports",
  "settings",
] as const;

export const RBAC_ACTIONS = ["view", "create", "edit", "delete", "export"] as const;

export type RbacModule = (typeof RBAC_MODULES)[number];
export type RbacAction = (typeof RBAC_ACTIONS)[number];

export type Permissions = Partial<Record<RbacModule, Partial<Record<RbacAction, boolean>>>>;

export interface IRoleDocument extends Document {
  roleId: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  isSystem: boolean;
  permissions: Permissions;
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema: Schema = new Schema(
  {
    roleId: { type: String, unique: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "", trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    isSystem: { type: Boolean, default: false },
    permissions: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

RoleSchema.pre("save", async function (next) {
  const doc = this as unknown as IRoleDocument;
  if (!doc.roleId) {
    const last = await mongoose
      .model("Role")
      .findOne({ roleId: { $regex: /^ROLE-/ } })
      .sort({ roleId: -1 })
      .select("roleId");
    let nextNum = 1;
    if (last && (last as any).roleId) {
      const n = parseInt((last as any).roleId.replace("ROLE-", ""), 10);
      if (!isNaN(n)) nextNum = n + 1;
    }
    doc.roleId = `ROLE-${String(nextNum).padStart(3, "0")}`;
  }
  next();
});

export default mongoose.model<IRoleDocument>("Role", RoleSchema);
