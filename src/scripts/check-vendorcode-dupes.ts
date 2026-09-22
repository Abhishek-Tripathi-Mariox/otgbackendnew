import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { connectDB } from "../config/database";
import Vendor from "../models/Vendor.model";

const run = async () => {
  await connectDB();
  const dupes = await Vendor.aggregate([
    { $match: { vendorCode: { $exists: true, $ne: null } } },
    { $group: { _id: "$vendorCode", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log("Duplicate vendorCode groups:", dupes.length, JSON.stringify(dupes));
  const missing = await Vendor.countDocuments({
    $or: [{ vendorCode: { $exists: false } }, { vendorCode: null }, { vendorCode: "" }],
  });
  console.log("Vendors with missing/empty vendorCode:", missing);
  await mongoose.disconnect();
  process.exit(0);
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
