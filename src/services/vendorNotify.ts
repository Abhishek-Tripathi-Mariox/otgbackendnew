import mongoose from "mongoose";
import Vendor from "../models/Vendor.model";
import Notification from "../models/Notification.model";
import { sendPush } from "./pushService";

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
  // Deep-link target for a bulk-order/quotation notification, mirroring
  // `booking` — the vendor app routes data.quotationId to QuotationDetail.
  quotation?: mongoose.Types.ObjectId | string;
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
    quotation: opts.quotation,
    image: opts.image,
    createdBy: opts.createdBy,
  });

  // Also push to the vendors' devices. Previously this helper only wrote the
  // in-app row, so a vendor learned about a new order solely from the 20s
  // poll while the app was open — they got nothing at all when it was
  // backgrounded or closed. Mirrors notifyDrivers, including the same
  // deep-link data keys the vendor app already routes on.
  try {
    const devices = await Vendor.find({ _id: { $in: vendorIds } })
      .select("deviceInfo.fcmToken")
      .lean();
    const tokens = devices
      .map((v: any) => v?.deviceInfo?.fcmToken)
      .filter(Boolean) as string[];
    if (tokens.length) {
      const data: Record<string, string> = {};
      if (opts.booking) data.bookingId = String(opts.booking);
      if (opts.quotation) data.quotationId = String(opts.quotation);
      // Best-effort: a push failure must never fail the caller's request.
      sendPush(tokens, opts.title, opts.message, data).catch(() => {});
    }
  } catch {
    // Notification row is already written; push is a bonus channel.
  }
};
