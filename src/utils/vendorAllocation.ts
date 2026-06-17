import mongoose from "mongoose";
import VendorMaterial from "../models/VendorMaterial.model";
import Vendor from "../models/Vendor.model";
import Driver from "../models/Driver.model";

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

/**
 * Drivers eligible for dispatch assignment: active, approved, not deleted.
 * Used both for the vendor's driver picker and for auto-assignment fallback.
 */
export async function findAssignableDrivers(): Promise<
  Array<{
    _id: mongoose.Types.ObjectId;
    name?: string;
    vehicles?: Array<{ registrationNo?: string }>;
  }>
> {
  return Driver.find({
    status: "active",
    approvalStatus: "approved",
    isDeleted: false,
  })
    .select("name vehicles.registrationNo")
    .sort({ updatedAt: -1 })
    .lean();
}

/**
 * Auto-pick the first eligible (active + approved) driver for a dispatch when
 * the vendor doesn't choose one explicitly. Returns the driver doc or null.
 */
export async function findFirstAvailableDriver(): Promise<{
  _id: mongoose.Types.ObjectId;
  name?: string;
  vehicles?: Array<{ registrationNo?: string }>;
} | null> {
  const driver = await Driver.findOne({
    status: "active",
    approvalStatus: "approved",
    isDeleted: false,
  })
    .select("name vehicles.registrationNo")
    .sort({ updatedAt: -1 })
    .lean();
  return (driver as any) || null;
}
