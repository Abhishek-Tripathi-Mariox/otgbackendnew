import mongoose from "mongoose";
import Notification from "../models/Notification.model";

export interface NotifyAdminOptions {
  title: string;
  message: string;
  booking?: mongoose.Types.ObjectId | string;
  // Set when this notification concerns a Quotation rather than (or in
  // addition to) a Booking — lets the bell dropdown deep-link to the right
  // record type instead of always assuming a booking.
  quotation?: mongoose.Types.ObjectId | string;
  // Set when this notification concerns a Vendor (material added, rate
  // change) — lets the bell dropdown deep-link to that vendor's materials.
  vendor?: mongoose.Types.ObjectId | string;
  image?: string;
  // Who/what triggered this (a User/Vendor/Driver id, or omitted for a
  // purely system-triggered event e.g. "no driver available"). Notification
  // schema's `createdBy` ref is informational only (no existence check), so
  // any id — or the zero-id sentinel for system events — is fine here.
  createdBy?: mongoose.Types.ObjectId | string;
}

const SYSTEM_ID = new mongoose.Types.ObjectId("000000000000000000000000");

/**
 * Creates a shared, admin-targeted Notification (targetType "admin") — the
 * in-app source for the admin panel's polling bell/dropdown. Mirrors
 * notifyVendors/notifyDrivers's fire-and-forget, never-throws convention.
 */
export const notifyAdmin = async (opts: NotifyAdminOptions): Promise<void> => {
  try {
    await Notification.create({
      title: opts.title,
      message: opts.message,
      targetType: "admin",
      status: "sent",
      sentAt: new Date(),
      booking: opts.booking,
      quotation: opts.quotation,
      vendor: opts.vendor,
      image: opts.image,
      createdBy: opts.createdBy || SYSTEM_ID,
      readByAdmin: false,
    });
  } catch (error) {
    console.error("[adminNotify] Failed to create admin notification:", error);
  }
};
