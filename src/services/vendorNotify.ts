import mongoose from "mongoose";
import Vendor from "../models/Vendor.model";
import Notification from "../models/Notification.model";

/**
 * Finds active, approved vendors whose business pincode matches the given
 * delivery pincode, optionally excluding some vendor ids (e.g. the vendor
 * who just claimed/rejected the order). Shared by order-creation fan-out,
 * "order taken" notifications, and reject-reopen re-notification, so all
 * three use the exact same matching logic.
 */
export const findMatchingVendors = async (
  pincode: string,
  excludeVendorIds: Array<mongoose.Types.ObjectId | string> = [],
): Promise<mongoose.Types.ObjectId[]> => {
  if (!pincode) return [];
  const matching = await Vendor.find({
    "business.pincode": new RegExp(pincode),
    status: "active",
    approvalStatus: "approved",
    isDeleted: false,
    _id: { $nin: excludeVendorIds },
  })
    .select("_id")
    .lean();
  return matching.map((v) => v._id);
};

export interface NotifyVendorsOptions {
  title: string;
  message: string;
  booking?: mongoose.Types.ObjectId | string;
  image?: string;
  createdBy: mongoose.Types.ObjectId | string;
}

/**
 * Creates one shared Notification targeting the given vendor ids. No-ops if
 * the list is empty (never creates an empty-recipient notification).
 */
export const notifyVendors = async (
  vendorIds: Array<mongoose.Types.ObjectId | string>,
  opts: NotifyVendorsOptions,
): Promise<void> => {
  if (!vendorIds.length) return;
  await Notification.create({
    title: opts.title,
    message: opts.message,
    targetType: "specific",
    specificRecipients: { users: [], vendors: vendorIds, drivers: [] },
    sentTo: { userCount: 0, vendorCount: vendorIds.length, driverCount: 0 },
    status: "sent",
    sentAt: new Date(),
    booking: opts.booking,
    image: opts.image,
    createdBy: opts.createdBy,
  });
};
