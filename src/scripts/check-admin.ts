import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { connectDB } from "../config/database";
import Admin from "../models/Admin.model";
import mongoose from "mongoose";

const run = async () => {
  await connectDB();

  const targetEmail = (process.env.ADMIN_EMAIL || "admin@otg.com")
    .toLowerCase()
    .trim();
  const targetPassword = process.env.ADMIN_PASSWORD || "OtgAdmin@2026";

  console.log(`Target email:    ${targetEmail}`);
  console.log(`Target password: ${targetPassword}`);

  const admins = await Admin.find({}).select("+password");
  console.log(`\nFound ${admins.length} admin doc(s):`);
  for (const a of admins) {
    const matches = await bcrypt.compare(targetPassword, a.password);
    console.log(
      `  - ${a.email} | role=${a.role} | isActive=${a.isActive} | passwordMatchesEnv=${matches}`,
    );
  }

  // Find by target email
  let target = await Admin.findOne({ email: targetEmail }).select("+password");

  // Fallback: any super-admin
  if (!target) {
    target = await Admin.findOne({ role: "super-admin" }).select("+password");
    if (target) {
      console.log(
        `\nNo admin at ${targetEmail}; updating super-admin ${target.email} → ${targetEmail}`,
      );
      target.email = targetEmail;
    }
  }

  if (!target) {
    console.log("\nNo admin doc exists. Creating fresh super-admin...");
    target = new Admin({
      name: "Super Admin",
      email: targetEmail,
      password: await bcrypt.hash(targetPassword, 12),
      role: "super-admin",
      permissions: ["all"],
      isActive: true,
    });
    await target.save();
    console.log("Created.");
  } else {
    target.password = await bcrypt.hash(targetPassword, 12);
    target.isActive = true;
    if (!target.permissions || target.permissions.length === 0) {
      target.permissions = ["all"];
    }
    if (target.role !== "super-admin") target.role = "super-admin";
    await target.save();
    console.log(`\nReset password and ensured active super-admin: ${target.email}`);
  }

  // Verify
  const verify = await Admin.findOne({ email: targetEmail }).select("+password");
  if (verify) {
    const ok = await bcrypt.compare(targetPassword, verify.password);
    console.log(`\nVerification: password matches env = ${ok}`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
