/**
 * One-time fix: backfill `createdBy` on vendors that are missing it.
 *
 * Vendors created via the vendor-app onboarding have no `createdBy`, which
 * makes admin-panel vendor updates fail with "Path `createdBy` is required."
 * This sets createdBy (to an existing admin's id, or a fresh ObjectId if no
 * admin exists) for every such vendor.
 *
 * Run from the backend folder:
 *   node scripts/backfill-vendor-createdby.js
 *
 * Or pass the Mongo URI explicitly:
 *   node scripts/backfill-vendor-createdby.js "mongodb://user:pass@host:27017/dbname"
 */
const path = require("path");

// Load .env from the backend root if dotenv is available (ignore if not).
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (_) {
  /* dotenv not installed — rely on the process env / CLI arg */
}

const mongoose = require("mongoose");

(async () => {
  const uri =
    process.argv[2] ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/otg_admin_panel";

  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`Connected to database: ${db.databaseName}`);

  // Use an existing admin as the createdBy owner; fall back to a fresh id
  // (any valid ObjectId satisfies the required validator).
  const admin = await db.collection("admins").findOne({});
  const createdById = admin ? admin._id : new mongoose.Types.ObjectId();
  console.log(
    admin
      ? `Using admin ${admin.email || admin._id} as createdBy.`
      : `No admin found — using a generated id ${createdById} as createdBy.`,
  );

  const filter = {
    $or: [{ createdBy: { $exists: false } }, { createdBy: null }],
  };

  const before = await db.collection("vendors").countDocuments(filter);
  console.log(`Vendors missing createdBy: ${before}`);

  const result = await db
    .collection("vendors")
    .updateMany(filter, { $set: { createdBy: createdById } });

  console.log(
    `Done. matched=${result.matchedCount}, modified=${result.modifiedCount}`,
  );

  await mongoose.disconnect();
  console.log("Disconnected. ✅ Vendors can now be updated without the createdBy error.");
})().catch(async (err) => {
  console.error("Backfill failed:", err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
