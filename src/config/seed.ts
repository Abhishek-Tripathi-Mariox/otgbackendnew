import Admin from "../models/Admin.model";
import Vendor from "../models/Vendor.model";
import Role, { RBAC_MODULES, RBAC_ACTIONS } from "../models/Role.model";
import bcrypt from "bcryptjs";

const allTrue = () => {
  const perms: any = {};
  RBAC_MODULES.forEach((m) => {
    perms[m] = {};
    RBAC_ACTIONS.forEach((a) => (perms[m][a] = true));
  });
  return perms;
};

const subset = (mods: Partial<Record<string, string[]>>) => {
  const perms: any = {};
  RBAC_MODULES.forEach((m) => {
    perms[m] = {};
    RBAC_ACTIONS.forEach((a) => (perms[m][a] = false));
  });
  Object.entries(mods).forEach(([m, acts]) => {
    if (!perms[m]) perms[m] = {};
    (acts || []).forEach((a) => {
      perms[m][a] = true;
    });
  });
  return perms;
};

const SYSTEM_ROLES = [
  {
    name: "Super Admin",
    description: "Full access to all modules and features.",
    isSystem: true,
    status: "active" as const,
    permissions: allTrue(),
  },
  {
    name: "Operations Manager",
    description: "Manage bookings, vendors, drivers and logistics.",
    isSystem: true,
    status: "active" as const,
    permissions: subset({
      dashboard: ["view"],
      users: ["view"],
      vendors: ["view", "create", "edit", "export"],
      drivers: ["view", "create", "edit", "export"],
      materials: ["view", "create", "edit", "export"],
      categories: ["view", "create", "edit"],
      subCategories: ["view", "create", "edit"],
      bookings: ["view", "create", "edit", "export"],
      transactions: ["view", "export"],
      staff: ["view"],
      reports: ["view", "export"],
      settings: ["view"],
    }),
  },
  {
    name: "Sales Executive",
    description: "Handle bookings and customer interactions.",
    isSystem: true,
    status: "active" as const,
    permissions: subset({
      dashboard: ["view"],
      users: ["view"],
      vendors: ["view"],
      materials: ["view"],
      bookings: ["view", "create", "edit", "export"],
      transactions: ["view"],
      reports: ["view"],
    }),
  },
  {
    name: "Support Agent",
    description: "Handle customer queries and booking issues.",
    isSystem: true,
    status: "active" as const,
    permissions: subset({
      dashboard: ["view"],
      users: ["view", "edit"],
      bookings: ["view", "edit"],
      transactions: ["view"],
      notifications: ["view", "create"],
    }),
  },
  {
    name: "Finance Manager",
    description: "Manage transactions, settlements, and financial reports.",
    isSystem: true,
    status: "active" as const,
    permissions: subset({
      dashboard: ["view"],
      transactions: ["view", "create", "edit", "export"],
      bookings: ["view", "export"],
      reports: ["view", "export"],
      settings: ["view", "edit"],
    }),
  },
  {
    name: "Viewer",
    description: "Read-only access across all modules.",
    isSystem: true,
    status: "active" as const,
    permissions: RBAC_MODULES.reduce((acc: any, m) => {
      acc[m] = {};
      RBAC_ACTIONS.forEach((a) => (acc[m][a] = a === "view"));
      return acc;
    }, {}),
  },
];

const seedRoles = async (): Promise<void> => {
  for (const r of SYSTEM_ROLES) {
    const existing = await Role.findOne({ name: r.name });
    if (!existing) {
      await Role.create(r);
      console.log(`Seeded role: ${r.name}`);
    }
  }
};

export const seedAdmin = async (): Promise<void> => {
  try {
    await seedRoles();

    const targetEmail = (process.env.ADMIN_EMAIL || "admin@otg.com")
      .toLowerCase()
      .trim();
    const targetPassword = process.env.ADMIN_PASSWORD || "OtgAdmin@2026";

    let existingAdmin = await Admin.findOne({ role: "super-admin" }).select(
      "+password",
    );

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(targetPassword, 12);

      await Admin.create({
        name: "Super Admin",
        email: targetEmail,
        password: hashedPassword,
        role: "super-admin",
        permissions: ["all"],
        isActive: true,
      });

      console.log(`Super Admin seeded: ${targetEmail}`);
    } else {
      let changed = false;

      // Migrate legacy seeded admin email (e.g. admin@example.com) → configured admin email
      if (existingAdmin.email !== targetEmail) {
        const conflicting = await Admin.findOne({ email: targetEmail });
        if (!conflicting) {
          existingAdmin.email = targetEmail;
          changed = true;
          console.log(`Super Admin email migrated to: ${targetEmail}`);
        }
      }

      // Ensure the configured ADMIN_PASSWORD actually works on the seeded super-admin.
      // If the stored hash doesn't match ADMIN_PASSWORD, reset it.
      const matches = await bcrypt.compare(
        targetPassword,
        existingAdmin.password,
      );
      if (!matches) {
        existingAdmin.password = await bcrypt.hash(targetPassword, 12);
        changed = true;
        console.log(`Super Admin password synced with ADMIN_PASSWORD env`);
      }

      if (!existingAdmin.isActive) {
        existingAdmin.isActive = true;
        changed = true;
      }

      if (changed) await existingAdmin.save();
    }

    const backfill = await Vendor.updateMany(
      { addedByAdmin: { $exists: false } },
      { $set: { addedByAdmin: true } },
    );
    if (backfill.modifiedCount > 0) {
      console.log(
        `Backfilled addedByAdmin=true on ${backfill.modifiedCount} existing vendor(s)`,
      );
    }
  } catch (error) {
    console.error("Error seeding admin:", error);
  }
};
