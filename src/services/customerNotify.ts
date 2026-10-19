import mongoose from "mongoose";
import User from "../models/User.model";
import { sendPush } from "./pushService";

/**
 * Customer-facing notifications.
 *
 * The counterpart to adminNotify / vendorNotify / driverNotify, which did
 * not exist before: every lifecycle event notified the admin, the vendor or
 * the driver, and nothing ever reached the person who placed the order. A
 * customer therefore had no way to learn that their vendor had accepted,
 * packed or dispatched the order short of reopening the app and looking.
 *
 * Push only, deliberately: unlike vendors and drivers, customers have no
 * in-app notification inbox (no `readByUsers` on the Notification model), so
 * writing a Notification row here would create records nobody can ever read.
 * The push carries `bookingId`, which the customer app already routes to the
 * order details screen.
 */

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  accepted: {
    title: "Order confirmed",
    body: "Your supplier has confirmed your order and is preparing it.",
  },
  qc_pending: {
    title: "Quality check started",
    body: "Your order is going through a quality check.",
  },
  qc_approved: {
    title: "Quality check passed",
    body: "Your order passed its quality check and is being packed.",
  },
  packed: {
    title: "Order packed",
    body: "Your order is packed and awaiting dispatch.",
  },
  dispatched: {
    title: "Order dispatched",
    body: "Your order has been dispatched and is on its way.",
  },
  in_transit: {
    title: "Out for delivery",
    body: "Your order is out for delivery.",
  },
  delivered: {
    title: "Order delivered",
    body: "Your order has been delivered. Thank you!",
  },
  vendor_rejected: {
    title: "Supplier changed",
    body: "Your supplier could not fulfil this order. Our team is assigning a new one.",
  },
  cancelled: {
    title: "Order cancelled",
    body: "Your order has been cancelled.",
  },
};

/**
 * Pushes a status update for `booking` to the customer who placed it.
 *
 * Best-effort and never throws: a notification failure must not roll back
 * the status change that triggered it. Silently does nothing for statuses
 * with no customer-meaningful message, for guest/orphaned bookings, and for
 * customers with no registered device.
 */
export const notifyCustomerOrderStatus = async (
  userId: mongoose.Types.ObjectId | string | null | undefined,
  bookingId: mongoose.Types.ObjectId | string,
  status: string,
  humanBookingId?: string,
): Promise<void> => {
  try {
    if (!userId) return;
    const message = STATUS_MESSAGES[status];
    if (!message) return;

    const user = await User.findById(userId)
      .select("deviceInfo.fcmToken")
      .lean();
    const token = user?.deviceInfo?.fcmToken;
    if (!token) return;

    await sendPush(
      [token],
      message.title,
      humanBookingId ? `${humanBookingId}: ${message.body}` : message.body,
      { bookingId: String(bookingId) },
    );
  } catch {
    // Best-effort only.
  }
};
