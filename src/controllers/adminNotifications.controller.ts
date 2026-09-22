import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification.model";
import { AppError } from "../middlewares/errorHandler";
import { AuthRequest } from "../types";

// Admin-targeted notifications are a shared inbox for the whole admin panel
// (see Notification.model.ts's readByAdmin comment) — unlike the vendor/
// driver inboxes, "unread" isn't per-admin-user here.
const visibleQuery = { isDeleted: false, status: "sent", targetType: "admin" };

/**
 * GET /api/admin/notifications
 * List admin-targeted notifications (bell dropdown), newest first.
 */
export const listAdminNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const notifications = await Notification.find(visibleQuery)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const items = notifications.map((n: any) => ({
      _id: n._id,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt,
      booking: n.booking || null,
      quotation: n.quotation || null,
      vendor: n.vendor || null,
      image: n.image || null,
      unread: !n.readByAdmin,
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
 * GET /api/admin/notifications/unread-count
 * Lightweight count-only endpoint for the bell badge.
 */
export const getAdminUnreadCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const unreadCount = await Notification.countDocuments({
      ...visibleQuery,
      readByAdmin: { $ne: true },
    });
    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/notifications/read-all
 * Mark every currently-visible admin notification as read.
 */
export const markAllAdminNotificationsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await Notification.updateMany(visibleQuery, { $set: { readByAdmin: true } });
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/notifications/:id/read
 * Mark a single admin notification as read.
 */
export const markAdminNotificationRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid notification id", 400);
    }
    await Notification.updateOne(
      { _id: id, isDeleted: false },
      { $set: { readByAdmin: true } },
    );
    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    next(error);
  }
};
