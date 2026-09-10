import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/database";
import Config from "../models/Config.model";

// Deletes the stale Firebase Config document (created before the
// serviceAccountJson migration, still carrying the old projectId/apiKey/
// .../serverKey field shape) so the next GET /config/firebase recreates it
// fresh from the current SERVICE_DEFAULTS (a single serviceAccountJson
// field). Safe: confirmed via check-firebase-config-doc.ts that every field
// on the existing doc is empty and isActive is false — nothing of value is
// lost.
const run = async () => {
  await connectDB();

  const doc = await Config.findOne({ service: "firebase" });
  if (!doc) {
    console.log("No Config document exists for service='firebase' — nothing to reset.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const hasAnyValue = doc.fields.some((f) => f.value && f.value.trim());
  if (hasAnyValue || doc.isActive) {
    console.log(
      "REFUSING to delete: this document has a non-empty field or isActive=true — it may hold real data. Aborting without changes.",
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  await Config.deleteOne({ _id: doc._id });
  console.log(`Deleted stale Firebase Config doc (_id=${doc._id}). Next GET /config/firebase will recreate it from current SERVICE_DEFAULTS.`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
