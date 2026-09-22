import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/database";
import { sendPush } from "../services/pushService";
import Driver from "../models/Driver.model";
import Vendor from "../models/Vendor.model";
import User from "../models/User.model";

// Sends a REAL test push to whichever real device tokens are currently
// stored, and reports FCM's actual per-token result (not just "did the SDK
// accept the credential" like check-firebase.ts) — this is the definitive
// test of whether delivery itself works.
const run = async () => {
  await connectDB();

  const [driver, vendor, user] = await Promise.all([
    Driver.findOne({ "deviceInfo.fcmToken": { $exists: true, $ne: "" } }).select(
      "name deviceInfo.fcmToken",
    ),
    Vendor.findOne({ "deviceInfo.fcmToken": { $exists: true, $ne: "" } }).select(
      "name deviceInfo.fcmToken",
    ),
    User.findOne({ "deviceInfo.fcmToken": { $exists: true, $ne: "" } }).select(
      "name deviceInfo.fcmToken",
    ),
  ]);

  const targets: { label: string; token?: string }[] = [
    { label: "Driver", token: driver?.deviceInfo?.fcmToken },
    { label: "Vendor", token: vendor?.deviceInfo?.fcmToken },
    { label: "Customer", token: user?.deviceInfo?.fcmToken },
  ];

  for (const t of targets) {
    if (!t.token) {
      console.log(`${t.label}: no stored token — skipping.`);
      continue;
    }
    console.log(`\n${t.label}: sending real test push to token ending "...${t.token.slice(-12)}"`);
    const result = await sendPush(
      [t.token],
      "OTG Test Notification",
      "If you see this, push notifications are working correctly.",
      { type: "diagnostic_test" },
    );
    console.log(`${t.label}: sent=${result.sent} failed=${result.failed}`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
