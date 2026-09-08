import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import admin from "firebase-admin";
import { connectDB } from "../config/database";
import { isServiceReady } from "../services/configService";
import Driver from "../models/Driver.model";
import Vendor from "../models/Vendor.model";
import User from "../models/User.model";

// Read-only diagnostic. Never prints the private key or full service
// account JSON — only whether it's present/parseable and whether the SDK
// accepts it.
const run = async () => {
  await connectDB();

  const creds = await isServiceReady("firebase", ["serviceAccountJson"]);
  if (!creds) {
    console.log(
      "NOT CONFIGURED: no active Config doc for service='firebase' with a non-empty serviceAccountJson field.",
    );
    console.log(
      "-> Admin must set it via the admin panel's Integrations/Config screen for push to work.",
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log("Config found: service='firebase' is active with a serviceAccountJson value present.");

  let serviceAccount: any;
  try {
    serviceAccount = JSON.parse(creds.serviceAccountJson);
    console.log("serviceAccountJson parses as valid JSON.");
  } catch (e) {
    console.log("FAIL: serviceAccountJson is NOT valid JSON — pushService.ts will silently skip all sends.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const requiredKeys = ["type", "project_id", "private_key", "client_email"];
  const missing = requiredKeys.filter((k) => !serviceAccount[k]);
  if (missing.length) {
    console.log(`FAIL: serviceAccountJson is missing required key(s): ${missing.join(", ")}`);
  } else {
    console.log(
      `serviceAccountJson has all required keys. project_id="${serviceAccount.project_id}", client_email="${serviceAccount.client_email}", type="${serviceAccount.type}"`,
    );
  }

  // Try actually initializing the SDK with these credentials — this is the
  // real test: firebase-admin validates the private key format and project
  // id shape at cert() time.
  try {
    const app = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      "otg-push-diagnostic",
    );
    console.log("firebase-admin SDK: credential.cert() + initializeApp() succeeded.");

    // getMessaging() itself doesn't make a network call, so this only
    // confirms the SDK accepted the credential shape, not that the project
    // is reachable/enabled for FCM. A real send would need a live device
    // token, which we don't have here.
    const messaging = app.messaging();
    console.log("app.messaging() handle obtained without error.");

    await app.delete();
  } catch (e: any) {
    console.log("FAIL: firebase-admin rejected the credential:", e?.message || e);
  }

  // How many devices actually HAVE a stored fcmToken right now (i.e. is
  // there anything to even push to)?
  const [driversWithToken, vendorsWithToken, usersWithToken] = await Promise.all([
    Driver.countDocuments({ "deviceInfo.fcmToken": { $exists: true, $ne: "" } }),
    Vendor.countDocuments({ "deviceInfo.fcmToken": { $exists: true, $ne: "" } }),
    User.countDocuments({ "deviceInfo.fcmToken": { $exists: true, $ne: "" } }),
  ]);
  console.log(
    `\nDevices with a stored fcmToken — Drivers: ${driversWithToken}, Vendors: ${vendorsWithToken}, Users: ${usersWithToken}.`,
  );
  if (driversWithToken + vendorsWithToken + usersWithToken === 0) {
    console.log(
      "-> No device has ever registered an FCM token yet. sendPush() will always report {sent:0, failed:0} until at least one real app instance logs in on a real device (FCM tokens aren't issued in simulators without google-services.json / GoogleService-Info.plist configured).",
    );
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
