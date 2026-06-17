import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Booking, { pushStatus } from "../models/Booking.model";
import { AppError } from "../middlewares/errorHandler";
import { DriverRequest } from "../middlewares/driverAuth.middleware";

type UiStatus = "in_progress" | "delivered" | "rejected";

// A driver becomes responsible for an order the moment the vendor dispatches it
// (status `dispatched`); from there the driver moves it pickup → in_transit →
// delivered. `accepted`/`confirmed`/`packed` are included so a pre-assigned
// driver still sees the order while the vendor is preparing it.
const ACTIVE_STATUSES = [
  "accepted",
  "confirmed",
  "packed",
  "dispatched",
  "in_transit",
];
// Statuses the driver can act on as a "new offer" awaiting pickup.
const OFFER_STATUSES = ["dispatched"];
const COMPLETED_STATUSES = ["delivered"];
const REJECTED_STATUSES = ["cancelled"];

const populateBooking = (q: any) =>
  q
    .populate("vendor", "business name")
    .populate("material", "name unit")
    .populate("user", "name mobile");

const toUiStatus = (booking: any): UiStatus => {
  if (booking.status === "delivered") return "delivered";
  if (booking.status === "cancelled") return "rejected";
  return "in_progress";
};

const formatBooking = (booking: any) => {
  const vendorName =
    booking.vendor?.business?.name || booking.vendor?.name || "Vendor";
  const vendorAddr =
    booking.vendor?.business?.address ||
    "";
  const pickup = vendorAddr ? `${vendorName} · ${vendorAddr}` : vendorName;

  return {
    id: booking.bookingId,
    _id: booking._id,
    status: toUiStatus(booking),
    rawStatus: booking.status,
    pickup,
    drop: booking.site || "Delivery site not set",
    date: booking.createdAt,
    earnings: booking.driverFee || 0,
    material: booking.material?.name,
    quantity: booking.quantity,
    unit: booking.unit,
  };
};

const startOfDay = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Start of the current week (Monday) and current month — used for the
// driver dashboard's Daily / Weekly / Monthly earnings breakdown.
const startOfWeek = (d = new Date()) => {
  const day = startOfDay(d);
  const dow = (day.getDay() + 6) % 7; // 0 = Monday
  day.setDate(day.getDate() - dow);
  return day;
};

const startOfMonth = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), 1);

// GET /api/mobile/driver/orders?status=active|completed|rejected
export const getMyOrders = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    const statusGroup = (req.query.status as string) || "active";

    const filter: any = {
      driver: new mongoose.Types.ObjectId(driverId),
      isDeleted: false,
    };

    if (statusGroup === "active") {
      filter.status = { $in: ACTIVE_STATUSES };
    } else if (statusGroup === "completed") {
      filter.status = { $in: COMPLETED_STATUSES };
    } else if (statusGroup === "rejected") {
      filter.status = { $in: REJECTED_STATUSES };
    }
    // any other value → no status filter (returns everything)

    const bookings = await populateBooking(
      Booking.find(filter).sort({ createdAt: -1 }).limit(50),
    );

    res.json({
      success: true,
      data: bookings.map(formatBooking),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/driver/orders/:bookingId
export const getMyOrder = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    const { bookingId } = req.params;

    const booking = await populateBooking(
      Booking.findOne({
        bookingId,
        driver: new mongoose.Types.ObjectId(driverId),
        isDeleted: false,
      }),
    );

    if (!booking) throw new AppError("Order not found", 404);

    res.json({ success: true, data: formatBooking(booking) });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/mobile/driver/orders/:bookingId/status  body: { action }
// action: "accept" -> confirmed, "start" -> in_transit, "complete" -> delivered, "reject" -> cancelled
export const updateOrderStatus = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    const { bookingId } = req.params;
    const { action } = req.body as { action?: string };

    const valid = ["accept", "start", "complete", "reject"];
    if (!action || !valid.includes(action)) {
      throw new AppError(
        `Invalid action. Allowed: ${valid.join(", ")}`,
        400,
      );
    }

    const booking = await Booking.findOne({
      bookingId,
      driver: new mongoose.Types.ObjectId(driverId),
      isDeleted: false,
    });

    if (!booking) throw new AppError("Order not found", 404);

    if (action === "accept") {
      // Driver accepts a dispatched offer. (Legacy: pre-dispatch `pending`
      // assignments are still acceptable for backward compatibility.)
      if (!["dispatched", "pending"].includes(booking.status)) {
        throw new AppError(
          "Only dispatched offers can be accepted.",
          400,
        );
      }
      // Acceptance keeps the order at `dispatched` (driver has it, not yet
      // moving); pickup is the next step. We stamp history without changing
      // the lifecycle status so the customer timeline stays accurate.
      pushStatus(booking, "dispatched", "Driver accepted");
    } else if (action === "start") {
      // "Pickup" — driver has collected the load and is en route.
      if (!["dispatched", "packed", "confirmed", "accepted"].includes(booking.status)) {
        throw new AppError(
          "Only dispatched orders can be picked up.",
          400,
        );
      }
      pushStatus(booking, "in_transit", "Picked up");
    } else if (action === "complete") {
      if (booking.status !== "in_transit") {
        throw new AppError(
          "Only in-transit orders can be marked delivered.",
          400,
        );
      }
      // pushStatus stamps deliveryDate = now on delivery.
      pushStatus(booking, "delivered", "Delivered");
    } else if (action === "reject") {
      if (
        !["pending", "accepted", "confirmed", "packed", "dispatched"].includes(
          booking.status,
        )
      ) {
        throw new AppError(
          "This order can no longer be rejected.",
          400,
        );
      }
      pushStatus(booking, "cancelled", "Driver rejected");
      booking.driverRejectedAt = new Date();
    }

    await booking.save();
    const populated = await populateBooking(Booking.findById(booking._id));
    res.json({ success: true, data: formatBooking(populated) });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/driver/dashboard
// Returns counts + earnings used by the home screen.
export const getDashboard = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.driver!.id);
    const today = startOfDay();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    // Combined count + earnings for delivered bookings since a given date.
    const periodAgg = (since: Date) =>
      Booking.aggregate([
        {
          $match: {
            driver: driverId,
            isDeleted: false,
            status: "delivered",
            updatedAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: "$driverFee" },
          },
        },
      ]);

    const [
      activeCount,
      completedTodayCount,
      totalCompletedCount,
      todayDeliveredAgg,
      totalEarningsAgg,
      pendingPayoutAgg,
      weekAgg,
      monthAgg,
      newOffer,
      activeOrder,
    ] = await Promise.all([
      Booking.countDocuments({
        driver: driverId,
        isDeleted: false,
        status: { $in: ACTIVE_STATUSES },
      }),
      Booking.countDocuments({
        driver: driverId,
        isDeleted: false,
        status: "delivered",
        updatedAt: { $gte: today },
      }),
      Booking.countDocuments({
        driver: driverId,
        isDeleted: false,
        status: "delivered",
      }),
      Booking.aggregate([
        {
          $match: {
            driver: driverId,
            isDeleted: false,
            status: "delivered",
            updatedAt: { $gte: today },
          },
        },
        { $group: { _id: null, total: { $sum: "$driverFee" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            driver: driverId,
            isDeleted: false,
            status: "delivered",
          },
        },
        { $group: { _id: null, total: { $sum: "$driverFee" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            driver: driverId,
            isDeleted: false,
            status: "delivered",
            paymentStatus: { $ne: "completed" },
          },
        },
        { $group: { _id: null, total: { $sum: "$driverFee" } } },
      ]),
      periodAgg(weekStart),
      periodAgg(monthStart),
      // A "new offer" = a dispatched booking assigned to this driver awaiting
      // pickup. (driverRejectedAt is cleared on dispatch, so this is fresh.)
      populateBooking(
        Booking.findOne({
          driver: driverId,
          isDeleted: false,
          status: { $in: OFFER_STATUSES },
        }).sort({ createdAt: -1 }),
      ),
      // The currently in-progress order.
      populateBooking(
        Booking.findOne({
          driver: driverId,
          isDeleted: false,
          status: { $in: ACTIVE_STATUSES },
        }).sort({ createdAt: -1 }),
      ),
    ]);

    res.json({
      success: true,
      data: {
        completedTodayCount,
        totalCompletedCount,
        activeCount,
        todayEarnings: todayDeliveredAgg[0]?.total || 0,
        totalEarnings: totalEarningsAgg[0]?.total || 0,
        pendingPayout: pendingPayoutAgg[0]?.total || 0,
        // Per-period breakdown for the Earnings Snapshot Daily/Weekly/Monthly tabs.
        earnings: {
          daily: {
            trips: completedTodayCount,
            amount: todayDeliveredAgg[0]?.total || 0,
          },
          weekly: {
            trips: weekAgg[0]?.count || 0,
            amount: weekAgg[0]?.total || 0,
          },
          monthly: {
            trips: monthAgg[0]?.count || 0,
            amount: monthAgg[0]?.total || 0,
          },
        },
        newOffer: newOffer ? formatBooking(newOffer) : null,
        activeOrder: activeOrder ? formatBooking(activeOrder) : null,
      },
    });
  } catch (error) {
    next(error);
  }
};
