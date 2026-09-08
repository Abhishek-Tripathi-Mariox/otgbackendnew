import mongoose from "mongoose";
import Driver from "../models/Driver.model";
import Notification from "../models/Notification.model";
import { sendPush } from "./pushService";

export interface MatchingDriver {
  _id: mongoose.Types.ObjectId;
  fcmToken?: string;
}

/**
 * Finds online, active, approved drivers whose registered pincode matches
 * the given delivery pincode, optionally excluding some driver ids (e.g. a
 * driver who just rejected the order) and filtering out anyone whose
 * heaviest vehicle can't carry `requiredWeightKg` (vehicle-capacity
 * matching). Mirrors vendorNotify.ts's findMatchingVendors so both fan-out
 * paths (new order to vendor, new delivery request to driver) work the same
 * way. When `requiredWeightKg` is omitted, or a driver hasn't filled in a
 * numeric capacity for any vehicle, that driver is never excluded — capacity
 * data is opt-in, not a hard requirement to receive offers.
 */
export const findMatchingDrivers = async (
  pincode: string,
  opts: {
    excludeDriverIds?: Array<mongoose.Types.ObjectId | string>;
    requiredWeightKg?: number;
  } = {},
): Promise<MatchingDriver[]> => {
  if (!pincode) return [];

  const drivers = await Driver.find({
    "address.pincode": new RegExp(pincode),
    status: "active",
    approvalStatus: "approved",
    isOnline: true,
    isDeleted: false,
    _id: { $nin: opts.excludeDriverIds || [] },
  })
    .select("_id deviceInfo.fcmToken vehicles.liftingCapacityKg")
    .lean();

  const required = opts.requiredWeightKg;
  const eligible = !required
    ? drivers
    : drivers.filter((d: any) => {
        const capacities = (d.vehicles || [])
          .map((v: any) => Number(v.liftingCapacityKg) || 0)
          .filter((n: number) => n > 0);
        // No vehicle has a known numeric capacity — don't restrict.
        if (capacities.length === 0) return true;
        return Math.max(...capacities) >= required;
      });

  return eligible.map((d: any) => ({
    _id: d._id,
    fcmToken: d.deviceInfo?.fcmToken,
  }));
};

export interface NotifyDriversOptions {
  title: string;
  message: string;
  booking?: mongoose.Types.ObjectId | string;
  image?: string;
  createdBy: mongoose.Types.ObjectId | string;
}

/**
 * Creates a shared Notification targeting the given drivers (their in-app
 * inbox, read via driverNotifications.controller.ts) AND sends a real FCM
 * push to whichever of them have a device token — the two together are what
 * make a new/dispatched order actually surface promptly instead of only on
 * the next 20s dashboard poll. No-ops if the list is empty. Never throws.
 */
export const notifyDrivers = async (
  drivers: MatchingDriver[],
  opts: NotifyDriversOptions,
): Promise<void> => {
  if (!drivers.length) return;
  try {
    await Notification.create({
      title: opts.title,
      message: opts.message,
      targetType: "specific",
      specificRecipients: {
        users: [],
        vendors: [],
        drivers: drivers.map((d) => d._id),
      },
      sentTo: { userCount: 0, vendorCount: 0, driverCount: drivers.length },
      status: "sent",
      sentAt: new Date(),
      booking: opts.booking,
      image: opts.image,
      createdBy: opts.createdBy,
    });
  } catch (error) {
    console.error("[driverNotify] Failed to create driver notification:", error);
  }

  const tokens = drivers
    .map((d) => d.fcmToken)
    .filter((t): t is string => Boolean(t));
  if (tokens.length) {
    sendPush(
      tokens,
      opts.title,
      opts.message,
      opts.booking ? { bookingId: String(opts.booking) } : undefined,
    ).catch(() => {});
  }
};
