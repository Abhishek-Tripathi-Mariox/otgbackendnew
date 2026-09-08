import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Booking, { pushStatus, isCodPaymentMethod } from "../models/Booking.model";
import Driver from "../models/Driver.model";
import Material from "../models/Material.model";
import { AppError } from "../middlewares/errorHandler";
import { DriverRequest } from "../middlewares/driverAuth.middleware";
import { ensureInvoicesGenerated } from "../services/invoiceService";
import { findMatchingDrivers, notifyDrivers } from "../services/driverNotify";
import { notifyAdmin } from "../services/adminNotify";

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
// A vendor accepting an order (pre-pack/pre-dispatch) makes it visible as an
// early, unassigned offer to any driver whose registered pincode matches the
// delivery pincode — first driver to accept claims it. The vendor's later
// dispatch-time picker still runs independently and can reassign.
// "packed"/"dispatched" are included here too — the only way a booking
// reaches one of those statuses with `driver: null` is a driver rejection
// (see the "reject" branch below), which clears the driver but leaves the
// lifecycle status untouched so the customer's tracking timeline doesn't
// regress; those bookings must still be re-claimable by another driver.
const EARLY_OFFER_STATUSES = ["accepted", "confirmed", "packed", "dispatched"];
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

const formatBooking = (booking: any, stage?: "dispatch" | "early") => {
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
    date:
      booking.status === "delivered"
        ? booking.deliveryDate || booking.updatedAt
        : booking.createdAt,
    earnings: booking.driverFee || 0,
    material: booking.material?.name,
    quantity: booking.quantity,
    unit: booking.unit,
    isCod: isCodPaymentMethod(booking.paymentMethod),
    // Shown to the driver before/during delivery too (not just after), so
    // they know up front how much cash to collect — previously this was
    // gated to `status === "delivered"`, making it invisible exactly when
    // it mattered most.
    codAmount: isCodPaymentMethod(booking.paymentMethod)
      ? booking.totalAmount || 0
      : 0,
    ...(stage ? { stage } : {}),
  };
};

// Extract the 6-digit pincode out of a driver's free-form address string.
const driverPincode = (driver: any): string | undefined =>
  (String(driver?.address?.pincode ?? "").match(/\d{6}/) || [])[0];

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

    // A driver must be online to make forward progress on a delivery
    // (accept / pickup / mark delivered). Rejecting is allowed while offline.
    let driverDoc: any = null;
    if (action !== "reject") {
      driverDoc = await Driver.findById(driverId).select(
        "isOnline address.pincode vehicles.liftingCapacityKg",
      );
      if (!driverDoc?.isOnline) {
        throw new AppError(
          "You are offline. Go online to update the delivery status.",
          400,
        );
      }
    }

    let booking = await Booking.findOne({
      bookingId,
      driver: new mongoose.Types.ObjectId(driverId),
      isDeleted: false,
    });

    // "accept" can also claim an unassigned early offer — a vendor-accepted
    // order (not yet packed/dispatched) whose delivery pincode matches this
    // driver's registered pincode. Atomic first-come-first-serve: whoever
    // claims it first gets `driver` set, everyone else gets null back.
    if (!booking && action === "accept") {
      const pin = driverPincode(driverDoc);
      if (pin) {
        // Vehicle-capacity matching: check the target booking's required
        // weight against this driver's own vehicles before attempting the
        // claim — done as a read here (not baked into the atomic filter
        // below) since it needs a Material lookup; the atomic update still
        // re-checks driver:null/status/pincode so the claim itself stays
        // race-safe, this just pre-empts an obviously-too-small vehicle.
        const candidate = await Booking.findOne({
          bookingId,
          driver: null,
          isDeleted: false,
          status: { $in: EARLY_OFFER_STATUSES },
          pincode: new RegExp(pin),
        })
          .select("material quantity")
          .lean();

        if (candidate) {
          const material = await Material.findById(candidate.material)
            .select("weightPerUnit")
            .lean();
          const requiredWeightKg = material?.weightPerUnit
            ? material.weightPerUnit * candidate.quantity
            : 0;
          if (requiredWeightKg > 0) {
            const capacities = (driverDoc?.vehicles || [])
              .map((v: any) => Number(v.liftingCapacityKg) || 0)
              .filter((n: number) => n > 0);
            const maxCapacity = capacities.length ? Math.max(...capacities) : 0;
            if (maxCapacity > 0 && maxCapacity < requiredWeightKg) {
              throw new AppError(
                `This delivery needs a vehicle capacity of at least ${requiredWeightKg}kg.`,
                400,
              );
            }
          }

          booking = await Booking.findOneAndUpdate(
            {
              bookingId,
              driver: null,
              isDeleted: false,
              status: { $in: EARLY_OFFER_STATUSES },
              pincode: new RegExp(pin),
            },
            {
              $set: { driver: new mongoose.Types.ObjectId(driverId) },
              $push: {
                statusHistory: {
                  status: "accepted",
                  at: new Date(),
                  note: "Driver accepted (early offer)",
                },
              },
            },
            { new: true },
          );
        }
      }
      if (!booking) {
        throw new AppError("This delivery is no longer available.", 409);
      }
      const populated = await populateBooking(Booking.findById(booking._id));
      res.json({ success: true, data: formatBooking(populated) });
      return;
    }

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
      const { podPhotoUrl } = req.body as { podPhotoUrl?: string };
      if (!podPhotoUrl || typeof podPhotoUrl !== "string") {
        throw new AppError(
          "A proof-of-delivery photo is required to mark this order delivered.",
          400,
        );
      }
      booking.podPhotoUrl = podPhotoUrl;
      // pushStatus stamps deliveryDate = now on delivery.
      pushStatus(booking, "delivered", "Delivered");
      // COD cash changes hands right here — the customer's payment is now
      // complete, and this delivery becomes part of the driver's cash-in-hand
      // (see driverCash.controller.ts).
      if (isCodPaymentMethod(booking.paymentMethod)) {
        booking.paymentStatus = "completed";
      }
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
      // Reassign instead of cancelling the customer's whole order: clear the
      // driver assignment and record the rejection, but deliberately leave
      // `booking.status` unchanged so the customer's tracking timeline
      // doesn't regress — EARLY_OFFER_STATUSES already includes every status
      // this branch allows, so the booking becomes re-claimable by another
      // pincode-matched driver the same way a fresh early offer is.
      if (!Array.isArray(booking.rejectedByDrivers)) booking.rejectedByDrivers = [];
      booking.rejectedByDrivers.push(new mongoose.Types.ObjectId(driverId));
      booking.driver = null as any;
      booking.driverRejectedAt = new Date();
      if (!Array.isArray(booking.statusHistory)) booking.statusHistory = [];
      booking.statusHistory.push({
        status: booking.status,
        at: new Date(),
        note: "Driver rejected — looking for another driver",
      });
    }

    await booking.save();

    if (action === "complete") {
      notifyAdmin({
        title: "Order delivered",
        message: `Order ${booking.bookingId} was marked delivered.`,
        booking: booking._id,
      }).catch(() => {});
    }

    // Re-notify other matching drivers (or alert admin if none are
    // available) after a rejection — fire-and-forget, never blocks the
    // driver's own response.
    if (action === "reject") {
      (async () => {
        try {
          const pin = booking!.pincode
            ? (String(booking!.pincode).match(/\d{6}/) || [])[0]
            : undefined;
          let requiredWeightKg: number | undefined;
          const material = await Material.findById(booking!.material)
            .select("weightPerUnit")
            .lean();
          if (material?.weightPerUnit) {
            requiredWeightKg = material.weightPerUnit * booking!.quantity;
          }

          const candidates = pin
            ? await findMatchingDrivers(pin, {
                excludeDriverIds: booking!.rejectedByDrivers,
                requiredWeightKg,
              })
            : [];

          if (candidates.length > 0) {
            await notifyDrivers(candidates, {
              title: "New delivery available",
              message: `A delivery is available in your area (pincode ${pin}). Accept it before another driver does.`,
              booking: booking!._id,
              createdBy: booking!.user,
            });
          } else {
            await notifyAdmin({
              title: "No driver available",
              message: `Booking ${booking!.bookingId} was rejected by a driver and no other matching driver is currently available.`,
              booking: booking!._id,
            });
          }
        } catch (error) {
          console.error("[driverOrders] Re-notify after rejection failed:", error);
        }
      })();
    }

    // Fire-and-forget: no-ops unless this delivery just made the booking
    // both delivered AND paid (e.g. COD payment completing right above).
    if (booking.status === "delivered" && booking.paymentStatus === "completed") {
      ensureInvoicesGenerated(String(booking._id)).catch(() => {});
    }

    const populated = await populateBooking(Booking.findById(booking._id));
    res.json({ success: true, data: formatBooking(populated) });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/mobile/driver/online  { isOnline: boolean }
// Persists the driver's online/offline duty state.
export const setOnlineStatus = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    const { isOnline } = req.body as { isOnline?: boolean };
    if (typeof isOnline !== "boolean") {
      throw new AppError("isOnline (boolean) is required.", 400);
    }

    const driver = await Driver.findById(driverId).select("isOnline lastOnlineAt");
    if (!driver) throw new AppError("Driver not found", 404);

    driver.isOnline = isOnline;
    if (isOnline) driver.lastOnlineAt = new Date();
    await driver.save({ validateModifiedOnly: true });

    res.json({ success: true, data: { isOnline: driver.isOnline } });
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

    const driverDoc = await Driver.findById(driverId).select(
      "isOnline address.pincode",
    );
    const pin = driverPincode(driverDoc);

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
      dispatchOffer,
      earlyOffer,
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
      // An early offer = a vendor-accepted booking, not yet assigned to any
      // driver, whose delivery pincode matches this driver's registered
      // pincode. Any matching driver can see and claim it.
      pin
        ? populateBooking(
            Booking.findOne({
              driver: null,
              isDeleted: false,
              status: { $in: EARLY_OFFER_STATUSES },
              pincode: new RegExp(pin),
            }).sort({ createdAt: -1 }),
          )
        : Promise.resolve(null),
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
        // Dispatch-stage offers (already assigned to this driver) take
        // priority over an early, unclaimed pincode-matched offer.
        newOffer: dispatchOffer
          ? formatBooking(dispatchOffer, "dispatch")
          : earlyOffer
            ? formatBooking(earlyOffer, "early")
            : null,
        activeOrder: activeOrder ? formatBooking(activeOrder) : null,
        isOnline: driverDoc?.isOnline ?? false,
      },
    });
  } catch (error) {
    next(error);
  }
};
