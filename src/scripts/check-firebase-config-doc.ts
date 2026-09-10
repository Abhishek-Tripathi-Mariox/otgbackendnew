import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/database";
import Config from "../models/Config.model";

// Read-only — reports field KEYS/LABELS and whether each has a non-empty
// value, never the decrypted secret itself.
const run = async () => {
  await connectDB();

  const doc = await Config.findOne({ service: "firebase" });
  if (!doc) {
    console.log("No Config document exists for service='firebase' at all.");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found Config doc: _id=${doc._id} isActive=${doc.isActive} label="${doc.label}"`);
  console.log(`updatedAt=${doc.updatedAt}`);
  console.log("Fields:");
  for (const f of doc.fields) {
    console.log(`  - key="${f.key}" label="${f.label}" hasValue=${Boolean(f.value && f.value.trim())}`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
