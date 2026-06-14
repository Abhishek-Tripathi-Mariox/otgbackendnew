import { Request, Response, NextFunction } from "express";
import Booking from "../models/Booking.model";
import Material from "../models/Material.model";
import Vendor from "../models/Vendor.model";
import { AppError } from "../middlewares/errorHandler";
import { AuthRequest } from "../types";

// Generate unique booking ID
const generateBookingId = async (): Promise<string> => {
  const count = await Booking.countDocuments();
  const timestamp = Date.now().toString().slice(-6);
  return `BK-${count + 1}-${timestamp}`;
};

// Get all bookings with filters
export const getBookings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      paymentStatus,
      vendor,
      user,
      fromDate,
      toDate,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = { isDeleted: false };

    if (status) {
      query.status = status;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (vendor) {
      query.vendor = vendor;
    }

    if (user) {
      query.user = user;
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        query.createdAt.$gte = new Date(fromDate as string);
      }
      if (toDate) {
        const endDate = new Date(toDate as string);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate("user", "name mobile email")
        .populate("vendor", "name mobile email")
        .populate("material", "name image unit")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Booking.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: bookings,
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

// Get single booking
export const getBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id)
      .populate("user", "name mobile email address")
      .populate("vendor", "name mobile email")
      .populate("material", "name image unit description");

    if (!booking) {
      throw new AppError("Booking not found.", 404);
    }

    res.json({
      success: true,
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

// Create booking
export const createBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { user, vendor, material, quantity, unit, price, site, notes } =
      req.body;

    // Validate required fields
    if (!user || !vendor || !material || !quantity || !price) {
      throw new AppError("Missing required fields.", 400);
    }

    const totalAmount = quantity * price;
    const bookingId = await generateBookingId();

    const booking = await Booking.create({
      bookingId,
      user,
      vendor,
      material,
      quantity,
      unit,
      price,
      totalAmount,
      site,
      notes,
      createdBy: user,
    });

    const populatedBooking = await Booking.findById(booking._id)
      .populate("user", "name mobile email")
      .populate("vendor", "name mobile email")
      .populate("material", "name image unit");

    res.status(201).json({
      success: true,
      message: "Booking created successfully.",
      data: populatedBooking,
    });
  } catch (error) {
    next(error);
  }
};

// Update booking
export const updateBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, paymentStatus, notes, site } = req.body;

    const booking = await Booking.findById(id);

    if (!booking) {
      throw new AppError("Booking not found.", 404);
    }

    if (status) booking.status = status;
    if (paymentStatus) booking.paymentStatus = paymentStatus;
    if (notes !== undefined) booking.notes = notes;
    if (site !== undefined) booking.site = site;
    booking.updatedBy = req.admin?._id as any;

    await booking.save();

    const populatedBooking = await Booking.findById(booking._id)
      .populate("user", "name mobile email")
      .populate("vendor", "name mobile email")
      .populate("material", "name image unit");

    res.json({
      success: true,
      message: "Booking updated successfully.",
      data: populatedBooking,
    });
  } catch (error) {
    next(error);
  }
};

// Update booking status
export const updateBookingStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, paymentStatus } = req.body;

    const booking = await Booking.findById(id);

    if (!booking) {
      throw new AppError("Booking not found.", 404);
    }

    if (status) {
      const validStatuses = [
        "pending",
        "confirmed",
        "in_transit",
        "delivered",
        "cancelled",
      ];
      if (!validStatuses.includes(status)) {
        throw new AppError(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          400,
        );
      }
      booking.status = status;
    }

    if (paymentStatus) {
      const validPaymentStatuses = ["pending", "partial", "completed"];
      if (!validPaymentStatuses.includes(paymentStatus)) {
        throw new AppError(
          `Invalid payment status. Must be one of: ${validPaymentStatuses.join(", ")}`,
          400,
        );
      }
      booking.paymentStatus = paymentStatus;
    }

    booking.updatedBy = req.admin?._id as any;
    await booking.save();

    const populatedBooking = await Booking.findById(booking._id)
      .populate("user", "name mobile email")
      .populate("vendor", "name mobile email")
      .populate("material", "name image unit");

    res.json({
      success: true,
      message: "Booking status updated successfully.",
      data: populatedBooking,
    });
  } catch (error) {
    next(error);
  }
};

// Allocate (or change/unassign) the vendor for a booking — admin action
export const allocateVendor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { vendorId } = req.body as { vendorId?: string | null };

    const booking = await Booking.findOne({ _id: id, isDeleted: false });
    if (!booking) {
      throw new AppError("Booking not found.", 404);
    }

    if (vendorId) {
      const vendor = await Vendor.findOne({
        _id: vendorId,
        isDeleted: false,
        status: "active",
      }).select("_id");
      if (!vendor) {
        throw new AppError("Vendor not found or inactive.", 400);
      }
      booking.vendor = vendor._id as any;
    } else {
      // Allow explicit un-assignment with vendorId: null
      booking.vendor = null;
    }

    booking.updatedBy = req.admin?._id as any;
    await booking.save();

    const populated = await Booking.findById(booking._id)
      .populate("user", "name mobile email")
      .populate("vendor", "name mobile email business")
      .populate("material", "name images unit");

    res.json({
      success: true,
      message: vendorId
        ? "Vendor allocated to booking."
        : "Vendor unassigned from booking.",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// Delete booking (soft delete)
export const deleteBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);

    if (!booking) {
      throw new AppError("Booking not found.", 404);
    }

    booking.isDeleted = true;
    booking.deletedAt = new Date();
    booking.deletedBy = req.admin?._id as any;

    await booking.save();

    res.json({
      success: true,
      message: "Booking deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// Get dashboard statistics
export const getDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Overall stats
    const stats = await Booking.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          confirmedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
          },
          inTransitOrders: {
            $sum: { $cond: [{ $eq: ["$status", "in_transit"] }, 1, 0] },
          },
          deliveredOrders: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
          totalRevenue: { $sum: "$totalAmount" },
          completedRevenue: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, "$totalAmount", 0],
            },
          },
        },
      },
    ]);

    // Today's stats (day-to-day)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayStats = await Booking.aggregate([
      {
        $match: {
          isDeleted: false,
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: null,
          todayOrders: { $sum: 1 },
          todayPending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          todayCompleted: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          todayRevenue: { $sum: "$totalAmount" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        ...(stats[0] || {
          totalOrders: 0,
          pendingOrders: 0,
          confirmedOrders: 0,
          inTransitOrders: 0,
          deliveredOrders: 0,
          cancelledOrders: 0,
          totalRevenue: 0,
          completedRevenue: 0,
        }),
        today: todayStats[0] || {
          todayOrders: 0,
          todayPending: 0,
          todayCompleted: 0,
          todayRevenue: 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get revenue trend data with date range
export const getRevenueTrend = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { from, to } = req.query;

    let startDate: Date;
    let endDate: Date = new Date();
    endDate.setHours(23, 59, 59, 999);

    if (from && to) {
      startDate = new Date(from as string);
      endDate = new Date(to as string);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Default: last 7 days
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
    }
    startDate.setHours(0, 0, 0, 0);

    const trend = await Booking.aggregate([
      {
        $match: {
          isDeleted: false,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill in missing dates with 0
    const filledData: { date: string; revenue: number; orders: number }[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = current.toISOString().split("T")[0];
      const found = trend.find((t: any) => t._id === dateStr);
      filledData.push({
        date: dateStr,
        revenue: found ? found.revenue : 0,
        orders: found ? found.orders : 0,
      });
      current.setDate(current.getDate() + 1);
    }

    res.json({
      success: true,
      data: filledData,
    });
  } catch (error) {
    next(error);
  }
};

// Get top 5 materials by booking count
export const getTopMaterials = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const topMaterials = await Booking.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: "$material",
          count: { $sum: 1 },
          totalQuantity: { $sum: "$quantity" },
          totalRevenue: { $sum: "$totalAmount" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "materials",
          localField: "_id",
          foreignField: "_id",
          as: "materialDetails",
        },
      },
      { $unwind: "$materialDetails" },
      {
        $project: {
          _id: 1,
          materialName: "$materialDetails.name",
          materialImage: "$materialDetails.image",
          unit: "$materialDetails.unit",
          count: 1,
          totalQuantity: 1,
          totalRevenue: 1,
        },
      },
    ]);

    res.json({
      success: true,
      data: topMaterials,
    });
  } catch (error) {
    next(error);
  }
};

// Get top 5 vendors by booking revenue
export const getTopVendors = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const topVendors = await Booking.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: "$vendor",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmount" },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "vendors",
          localField: "_id",
          foreignField: "_id",
          as: "vendorDetails",
        },
      },
      { $unwind: "$vendorDetails" },
      {
        $project: {
          _id: 1,
          vendorName: "$vendorDetails.name",
          vendorMobile: "$vendorDetails.mobile",
          count: 1,
          totalRevenue: 1,
          completedOrders: 1,
        },
      },
    ]);

    res.json({
      success: true,
      data: topVendors,
    });
  } catch (error) {
    next(error);
  }
};
