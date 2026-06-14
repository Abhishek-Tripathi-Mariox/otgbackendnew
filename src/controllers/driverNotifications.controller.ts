import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification.model";
import { AppError } from "../middlewares/errorHandler";
import { DriverRequest } from "../middlewares/driverAuth.middleware";

/**
 * Build the mongo query matching all notifications visible to the given driver.
 * Visible = sent + not globally deleted + not deleted by this driver +
 * targeted at "all" / "drivers" / "specific (and this driver is included)".
 */
const visibleNotificationsQuery = (driverId: string) => {
  const objectId = new mongoose.Types.ObjectId(driverId);
  return {
    isDeleted: false,
    status: "sent",
    deletedByDrivers: { $ne: objectId },
    $or: [
      { targetType: "all" },
      { targetType: "drivers" },
      { targetType: "specific", "specificRecipients.drivers": objectId },
    ],
  };
};

/**
 * GET /api/mobile/driver/notifications
 * List notifications visible to the logged-in driver, plus the unread count.
 */
export const listDriverNotifications = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver?.id;
    if (!driverId) throw new AppError("Unauthorized", 401);

    const query = visibleNotificationsQuery(driverId);
    const objectId = new mongoose.Types.ObjectId(driverId);

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const items = notifications.map((n: any) => ({
      _id: n._id,
      title: n.title,
      message: n.message,
      targetType: n.targetType,
      createdAt: n.createdAt,
      sentAt: n.sentAt,
      unread: !(n.readByDrivers || []).some((id: any) => id.equals(objectId)),
    }));

    const unreadCount = items.filter((n: any) => n.unread).length;

    res.json({
      success: true,
      data: items,
      meta: { unreadCount, total: items.length },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/mobile/driver/notifications/unread-count
 * Lightweight count-only endpoint for the global bell badge.
 */
export const getDriverUnreadCount = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver?.id;
    if (!driverId) throw new AppError("Unauthorized", 401);

    const objectId = new mongoose.Types.ObjectId(driverId);
    const unreadCount = await Notification.countDocuments({
      ...visibleNotificationsQuery(driverId),
      readByDrivers: { $ne: objectId },
    });

    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/mobile/driver/notifications/read-all
 * Mark every currently-visible notification as read for this driver.
 */
export const markAllDriverNotificationsRead = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver?.id;
    if (!driverId) throw new AppError("Unauthorized", 401);

    const query = visibleNotificationsQuery(driverId);
    await Notification.updateMany(query, {
      $addToSet: { readByDrivers: new mongoose.Types.ObjectId(driverId) },
    });

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/mobile/driver/notifications/:id/read
 * Mark a single notification as read for this driver.
 */
export const markDriverNotificationRead = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver?.id;
    if (!driverId) throw new AppError("Unauthorized", 401);

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid notification id", 400);
    }

    await Notification.updateOne(
      { _id: id, isDeleted: false },
      { $addToSet: { readByDrivers: new mongoose.Types.ObjectId(driverId) } },
    );

    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/mobile/driver/notifications/:id
 * Soft-hide a notification for this driver only (admin record remains intact).
 */
export const deleteDriverNotification = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver?.id;
    if (!driverId) throw new AppError("Unauthorized", 401);

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid notification id", 400);
    }

    await Notification.updateOne(
      { _id: id, isDeleted: false },
      {
        $addToSet: {
          deletedByDrivers: new mongoose.Types.ObjectId(driverId),
        },
      },
    );

    res.json({ success: true, message: "Notification removed" });
  } catch (error) {
    next(error);
  }
};
