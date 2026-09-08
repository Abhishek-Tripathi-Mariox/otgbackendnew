import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/database";
import Category from "../models/Category.model";
import SubCategory from "../models/SubCategory.model";

// Read-only diagnostic — client reports "adding material under the RCC
// category, the Sub-Category is not getting selected." No RCC-specific code
// exists anywhere (Materials.jsx's category->subcategory filter is generic),
// so this checks whether the actual DB records are the problem: a mismatched
// `subCategory.category` reference, or a non-"active" status (the dropdown
// filter requires status === "active").
const run = async () => {
  await connectDB();

  const categories = await Category.find({
    name: { $regex: "rcc", $options: "i" },
  }).lean();

  console.log(`Found ${categories.length} categor(y/ies) matching "RCC":`);
  for (const c of categories) {
    console.log(`  - _id=${c._id} name="${c.name}" status=${(c as any).status}`);
  }

  if (categories.length === 0) {
    console.log("\nNo category named RCC exists at all — that's the root cause.");
  }

  for (const c of categories) {
    const subs = await SubCategory.find({ category: c._id }).lean();
    console.log(
      `\nSubCategories linked to "${c.name}" (${c._id}): ${subs.length}`,
    );
    for (const s of subs) {
      console.log(
        `  - _id=${s._id} name="${s.name}" status=${(s as any).status} category=${s.category}`,
      );
    }
  }

  // Also check for subcategories whose NAME mentions RCC but whose `category`
  // field doesn't point at any of the categories found above — this is the
  // "mismatched reference" case.
  const rccNamedSubs = await SubCategory.find({
    name: { $regex: "rcc", $options: "i" },
  }).lean();
  console.log(`\nSubCategories with "RCC" in their own name: ${rccNamedSubs.length}`);
  const categoryIds = new Set(categories.map((c) => String(c._id)));
  for (const s of rccNamedSubs) {
    const linked = categoryIds.has(String(s.category));
    console.log(
      `  - _id=${s._id} name="${s.name}" status=${(s as any).status} category=${s.category} linkedToRccCategory=${linked}`,
    );
  }

  // The real suspect: Materials.jsx's `dispatch(getSubCategories())` sends
  // no params at all, and the admin's GET /sub-categories controller
  // defaults to limit=10 (subCategory.controller.ts:17-18, sorted by
  // createdAt desc) — so the Redux store only ever holds the 10
  // most-recently-created subcategories system-wide, not all of them.
  const totalSubs = await SubCategory.countDocuments({ isDeleted: false });
  const first10 = await SubCategory.find({ isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(10)
    .select("name category")
    .lean();
  console.log(`\nTotal non-deleted subcategories system-wide: ${totalSubs}`);
  console.log(
    `Materials.jsx's unpaginated fetch only loads the first 10 (createdAt desc):`,
  );
  first10.forEach((s) =>
    console.log(`  - "${s.name}" category=${s.category}`),
  );
  const rccIdsInFirst10 = first10.filter((s) =>
    categoryIds.has(String(s.category)),
  ).length;
  console.log(
    `\nOf RCC's ${categories.length ? "5" : "0"} subcategories, ${rccIdsInFirst10} are within that first-10 window.`,
  );

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
