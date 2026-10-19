/**
 * Backfill `Material.subCategory` for materials that have none.
 *
 * Why: the admin form treated sub-category as optional, so most materials
 * were saved without one. The customer app's sub-category filter chips then
 * returned an empty screen for those materials — they looked "missing from
 * the app" even though they were active and in the right category.
 *
 * Matching is deliberately conservative: a material is only linked when its
 * NAME contains a keyword that maps to exactly one sub-category inside its
 * OWN category. Anything ambiguous is left alone and reported, so no
 * material is ever filed under the wrong heading by guesswork.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/backfill-material-subcategory.ts          # dry run
 *   npx ts-node --transpile-only src/scripts/backfill-material-subcategory.ts --apply  # write
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Material from "../models/Material.model";
import SubCategory from "../models/SubCategory.model";

// Keyword -> sub-category NAME (matched case-insensitively within the
// material's own category). Extend this list rather than loosening the
// matching rules.
const KEYWORD_TO_SUBCATEGORY: Array<{ pattern: RegExp; subCategory: string }> = [
  { pattern: /\bcement\b/i, subCategory: "CEMENT" },
  { pattern: /\btmt\b/i, subCategory: "TMT STEEL" },
  { pattern: /\bshuttering\b/i, subCategory: "SHUTTERING" },
  { pattern: /\bcuplock|scaffold/i, subCategory: "CUPLOCK SCAFFOLDING" },
  { pattern: /\b(drill|grinder|chop saw|tile cutter|hammer|breaker)\b/i, subCategory: "POWER TOOL" },
  { pattern: /\b(nail|fastener|screw)\b/i, subCategory: "NAILS & FASTRNERS" },
  { pattern: /\bms angle\b/i, subCategory: "MS ANGLE" },
  { pattern: /\bms channel\b/i, subCategory: "MS CHANNEL" },
  { pattern: /\bi[- ]?beam\b/i, subCategory: "I-BEAM" },
  { pattern: /\bms flat/i, subCategory: "MS FLATS" },
  { pattern: /\bsquare bar\b/i, subCategory: "MS SQUARE BAR" },
  { pattern: /\bround bar\b/i, subCategory: "MS ROUND BAR" },
];

const run = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");
  const uri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/otg_admin_panel";

  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${apply ? "APPLY (writing)" : "DRY RUN"}\n`);

  const orphans = await Material.find({
    isDeleted: false,
    $or: [{ subCategory: null }, { subCategory: { $exists: false } }],
  })
    .select("name category subCategory")
    .lean();

  if (orphans.length === 0) {
    console.log("No materials are missing a sub-category. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Sub-categories grouped by their parent category, so a keyword can only
  // ever resolve within the material's own category.
  const subs = await SubCategory.find({ isDeleted: false, status: "active" })
    .select("name category")
    .lean();
  const subsByCategory = new Map<string, Array<{ _id: any; name: string }>>();
  subs.forEach((s: any) => {
    const key = String(s.category);
    if (!subsByCategory.has(key)) subsByCategory.set(key, []);
    subsByCategory.get(key)!.push({ _id: s._id, name: s.name });
  });

  let matched = 0;
  const skipped: string[] = [];

  for (const m of orphans as any[]) {
    const candidates = subsByCategory.get(String(m.category)) || [];
    if (candidates.length === 0) {
      skipped.push(`${m.name} — its category has no sub-categories`);
      continue;
    }

    const rule = KEYWORD_TO_SUBCATEGORY.find((r) => r.pattern.test(m.name));
    if (!rule) {
      skipped.push(`${m.name} — no keyword rule matched`);
      continue;
    }

    const target = candidates.find(
      (c) => c.name.toLowerCase() === rule.subCategory.toLowerCase(),
    );
    if (!target) {
      skipped.push(
        `${m.name} — "${rule.subCategory}" does not exist in its category`,
      );
      continue;
    }

    console.log(`  ${m.name}  ->  ${target.name}`);
    matched++;
    if (apply) {
      await Material.updateOne(
        { _id: m._id },
        { $set: { subCategory: target._id } },
      );
    }
  }

  console.log(`\n${matched} of ${orphans.length} will be linked.`);
  if (skipped.length) {
    console.log("\nLeft untouched (assign these by hand in the admin panel):");
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
  if (!apply && matched > 0) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
