import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/database";

const run = async () => {
  await connectDB();

  const coll = mongoose.connection.db!.collection("roles");
  const indexes = await coll.indexes();
  console.log("Current indexes on roles:");
  indexes.forEach((i) => console.log(`  - ${i.name}  keys=${JSON.stringify(i.key)}`));

  const stale = indexes.find((i) => i.name === "slug_1");
  if (stale) {
    await coll.dropIndex("slug_1");
    console.log("\nDropped stale index: slug_1");
  } else {
    console.log("\nNo slug_1 index found — nothing to do.");
  }

  // Also clean any partial docs that have slug:null but no name (corrupt seeds)
  const orphans = await coll.deleteMany({ name: { $exists: false } });
  if (orphans.deletedCount) {
    console.log(`Removed ${orphans.deletedCount} orphan role doc(s) without a name.`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
