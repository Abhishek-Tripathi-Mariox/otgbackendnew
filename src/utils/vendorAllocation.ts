import mongoose from "mongoose";
import VendorMaterial from "../models/VendorMaterial.model";
import Vendor from "../models/Vendor.model";

export const AUTO_ALLOCATE_RADIUS_KM = 50;

/**
 * Find the nearest vendor that sells `materialId` and is within `maxKm` of
 * the provided customer coordinates.
 *
 * Returns the vendor _id if a match exists, otherwise null. We intentionally
 * pick the geographically closest vendor — that's the most predictable rule
 * when several vendors stock the same material in range.
 */
export async function findNearestVendorForMaterial(
  materialId: string | mongoose.Types.ObjectId,
  customerCoords: [number, number] | null | undefined,
  maxKm: number = AUTO_ALLOCATE_RADIUS_KM,
): Promise<mongoose.Types.ObjectId | null> {
  if (
    !customerCoords ||
    customerCoords.length !== 2 ||
    (customerCoords[0] === 0 && customerCoords[1] === 0)
  ) {
    return null;
  }

  // Vendors that actually stock this material and have it available
  const stocking = await VendorMaterial.find({
    material: materialId,
    isAvailable: true,
  })
    .select("vendor")
    .lean();

  if (stocking.length === 0) return null;

  const vendorIds = stocking.map(s => s.vendor);

  // Find nearest among those vendors, within maxKm
  const nearest = await Vendor.findOne({
    _id: { $in: vendorIds },
    status: "active",
    isDeleted: false,
    location: {
      $nearSphere: {
        $geometry: {
          type: "Point",
          coordinates: customerCoords,
        },
        $maxDistance: maxKm * 1000, // meters
      },
    },
  })
    .select("_id")
    .lean();

  return (nearest?._id as mongoose.Types.ObjectId) || null;
}
