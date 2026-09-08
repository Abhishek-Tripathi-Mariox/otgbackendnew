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

// True when at least one vehicle has a known numeric capacity insufficient
// for `requiredWeightKg`, AND none of the driver's vehicles meet it — i.e.
// this driver should be excluded from a capacity-matched list. A driver with
// no numeric capacity entered on any vehicle is never excluded (capacity
// data is opt-in — see Driver.model.ts's `liftingCapacityKg` comment).
const isCapacityInsufficient = (
  vehicles: Array<{ liftingCapacityKg?: number }> | undefined,
  requiredWeightKg?: number,
): boolean => {
  if (!requiredWeightKg) return false;
  const capacities = (vehicles || [])
    .map((v) => Number(v.liftingCapacityKg) || 0)
    .filter((n) => n > 0);
  if (capacities.length === 0) return false;
  return Math.max(...capacities) < requiredWeightKg;
};

/**
 * Drivers eligible for dispatch assignment: active, approved, not deleted.
 * Used both for the vendor's driver picker and for auto-assignment fallback.
 * When `requiredWeightKg` is given (the booking being dispatched), drivers
 * whose every vehicle has a known-insufficient capacity are excluded —
 * automatic vehicle-capacity matching (see Driver.model.ts).
 */
export async function findAssignableDrivers(
  pincode?: string,
  requiredWeightKg?: number,
): Promise<
  Array<{
    _id: mongoose.Types.ObjectId;
    name?: string;
    vehicles?: Array<{ registrationNo?: string; liftingCapacityKg?: number }>;
  }>
> {
  const query: any = {
    status: "active",
    approvalStatus: "approved",
    isDeleted: false,
  };
  // When a vendor's pincode is given, only show drivers registered in the same
  // pincode (matched on the 6-digit code, ignoring spaces/format).
  const pin = (String(pincode ?? "").match(/\d{6}/) || [])[0];
  if (pin) {
    query["address.pincode"] = new RegExp(pin);
  }
  const drivers = await Driver.find(query)
    .select("name vehicles.registrationNo vehicles.liftingCapacityKg address.pincode")
    .sort({ updatedAt: -1 })
    .lean();
  return drivers.filter(
    (d: any) => !isCapacityInsufficient(d.vehicles, requiredWeightKg),
  );
}

/**
 * Auto-pick the first eligible (active + approved) driver for a dispatch when
 * the vendor doesn't choose one explicitly. Returns the driver doc or null.
 * Same capacity-matching exclusion as findAssignableDrivers.
 */
export async function findFirstAvailableDriver(requiredWeightKg?: number): Promise<{
  _id: mongoose.Types.ObjectId;
  name?: string;
  vehicles?: Array<{ registrationNo?: string; liftingCapacityKg?: number }>;
  deviceInfo?: { fcmToken?: string };
} | null> {
  const candidates = await Driver.find({
    status: "active",
    approvalStatus: "approved",
    isDeleted: false,
  })
    .select("name vehicles.registrationNo vehicles.liftingCapacityKg deviceInfo.fcmToken")
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();
  const eligible = candidates.filter(
    (d: any) => !isCapacityInsufficient(d.vehicles, requiredWeightKg),
  );
  return (eligible[0] as any) || null;
}
