import { Response, NextFunction } from "express";
import Notification from "../models/Notification.model";
import User from "../models/User.model";
import Vendor from "../models/Vendor.model";
import Driver from "../models/Driver.model";
import { AuthRequest } from "../types";

// GET /api/notifications - List all notifications
export const getNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      targetType,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = { isDeleted: false };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
      ];
    }

    if (
      targetType &&
      ["all", "users", "vendors", "drivers", "specific"].includes(
        targetType as string,
      )
    ) {
      query.targetType = targetType;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Notification.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/notifications/:id - Get single notification
export const getNotification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .populate("createdBy", "name email")
      .populate("specificRecipients.users", "name mobile email")
      .populate("specificRecipients.vendors", "name mobile email business.name")
      .populate("specificRecipients.drivers", "name mobile email");

    if (!notification) {
      res.status(404).json({ success: false, message: "Notification not found" });
      return;
    }

    res.json({ success: true, data: notification });
  } catch (error) {
    next(error);
  }
};

// POST /api/notifications/send - Send notification
export const sendNotification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { title, message, targetType, userIds, vendorIds, driverIds } =
      req.body;

    if (!title || !message || !targetType) {
      res.status(400).json({
        success: false,
        message: "Title, message, and target type are required",
      });
      return;
    }

    let userCount = 0;
    let vendorCount = 0;
    let driverCount = 0;
    const specificRecipients: {
      users: string[];
      vendors: string[];
      drivers: string[];
    } = {
      users: [],
      vendors: [],
      drivers: [],
    };

    switch (targetType) {
      case "all":
        userCount = await User.countDocuments({
          isDeleted: false,
          status: "active",
        });
        vendorCount = await Vendor.countDocuments({
          isDeleted: false,
          status: "active",
        });
        driverCount = await Driver.countDocuments({
          isDeleted: false,
          status: "active",
        });
        break;

      case "users":
        userCount = await User.countDocuments({
          isDeleted: false,
          status: "active",
        });
        break;

      case "vendors":
        vendorCount = await Vendor.countDocuments({
          isDeleted: false,
          status: "active",
        });
        break;

      case "drivers":
        driverCount = await Driver.countDocuments({
          isDeleted: false,
          status: "active",
        });
        break;

      case "specific":
        if (userIds && Array.isArray(userIds) && userIds.length > 0) {
          specificRecipients.users = userIds;
          userCount = userIds.length;
        }
        if (vendorIds && Array.isArray(vendorIds) && vendorIds.length > 0) {
          specificRecipients.vendors = vendorIds;
          vendorCount = vendorIds.length;
        }
        if (driverIds && Array.isArray(driverIds) && driverIds.length > 0) {
          specificRecipients.drivers = driverIds;
          driverCount = driverIds.length;
        }
        if (userCount === 0 && vendorCount === 0 && driverCount === 0) {
          res.status(400).json({
            success: false,
            message: "Please select at least one recipient",
          });
          return;
        }
        break;

      default:
        res.status(400).json({ success: false, message: "Invalid target type" });
        return;
    }

    const notification = await Notification.create({
      title,
      message,
      targetType,
      specificRecipients,
      sentTo: { userCount, vendorCount, driverCount },
      status: "sent",
      sentAt: new Date(),
      createdBy: req.admin!._id,
    });

    // TODO: Integrate with Firebase FCM to actually push notifications
    // For now we store the record; actual push can be added when Firebase config is active

    res.status(201).json({
      success: true,
      message: `Notification sent to ${userCount + vendorCount + driverCount} recipient(s)`,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/notifications/:id - Soft delete
export const deleteNotification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!notification) {
      res.status(404).json({ success: false, message: "Notification not found" });
      return;
    }

    notification.isDeleted = true;
    notification.deletedAt = new Date();
    notification.deletedBy = req.admin ? (req.admin._id as any) : null;
    await notification.save();

    res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    next(error);
  }
};

// GET /api/notifications/recipients/search - Search users & vendors for specific targeting
export const searchRecipients = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { search = "", type = "all" } = req.query;
    const searchStr = search as string;
    const results: { users: any[]; vendors: any[]; drivers: any[] } = {
      users: [],
      vendors: [],
      drivers: [],
    };

    const searchQuery = searchStr
      ? {
          $or: [
            { name: { $regex: searchStr, $options: "i" } },
            { mobile: { $regex: searchStr, $options: "i" } },
            { email: { $regex: searchStr, $options: "i" } },
          ],
        }
      : {};

    if (type === "all" || type === "users") {
      results.users = await User.find({
        ...searchQuery,
        isDeleted: false,
        status: "active",
      })
        .select("name mobile email")
        .limit(20)
        .lean();
    }

    if (type === "all" || type === "drivers") {
      results.drivers = await Driver.find({
        ...searchQuery,
        isDeleted: false,
        status: "active",
      })
        .select("name mobile email")
        .limit(20)
        .lean();
    }

    if (type === "all" || type === "vendors") {
      const vendorSearch = searchStr
        ? {
            $or: [
              { name: { $regex: searchStr, $options: "i" } },
              { mobile: { $regex: searchStr, $options: "i" } },
              { email: { $regex: searchStr, $options: "i" } },
              { "business.name": { $regex: searchStr, $options: "i" } },
            ],
          }
        : {};

      results.vendors = await Vendor.find({
        ...vendorSearch,
        isDeleted: false,
        status: "active",
      })
        .select("name mobile email business.name")
        .limit(20)
        .lean();
    }

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};
