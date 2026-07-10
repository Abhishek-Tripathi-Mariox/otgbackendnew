import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Booking, { COD_PAYMENT_METHOD_REGEX } from "../models/Booking.model";
import DriverCashDeposit from "../models/DriverCashDeposit.model";
import { AppError } from "../middlewares/errorHandler";
import { DriverRequest } from "../middlewares/driverAuth.middleware";

const DAY_FORMAT = "%Y-%m-%d";

const codCollectedMatch = (driverId: mongoose.Types.ObjectId) => ({
  driver: driverId,
  isDeleted: false,
  status: "delivered",
  paymentMethod: COD_PAYMENT_METHOD_REGEX,
});

type DailyRow = {
  date: string;
  collected: number;
  deposited: number;
  deliveries: number;
};

// GET /api/mobile/driver/cash/summary
// Full COD reconciliation: how much cash the driver is currently holding,
// how much he's already handed to the office, and a day-by-day breakdown —
// collected from COD deliveries auto-recorded on "Delivered", deposited from
// the driver's own self-logged deposit entries.
export const getCashSummary = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.driver!.id);
    const match = codCollectedMatch(driverId);

    const [collectedAgg, depositedAgg, collectedByDay, depositedByDay] =
      await Promise.all([
        Booking.aggregate([
          { $match: match },
          { $group: { _id: null, total: { $sum: "$totalAmount" } } },
        ]),
        DriverCashDeposit.aggregate([
          { $match: { driver: driverId } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Booking.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: DAY_FORMAT,
                  date: { $ifNull: ["$deliveryDate", "$updatedAt"] },
                },
              },
              collected: { $sum: "$totalAmount" },
              deliveries: { $sum: 1 },
            },
          },
        ]),
        DriverCashDeposit.aggregate([
          { $match: { driver: driverId } },
          {
            $group: {
              _id: {
                $dateToString: { format: DAY_FORMAT, date: "$createdAt" },
              },
              deposited: { $sum: "$amount" },
            },
          },
        ]),
      ]);

    const totalCollected = collectedAgg[0]?.total || 0;
    const totalDeposited = depositedAgg[0]?.total || 0;
    const cashInHand = Math.max(0, +(totalCollected - totalDeposited).toFixed(2));

    const byDate = new Map<string, DailyRow>();
    for (const row of collectedByDay as any[]) {
      byDate.set(row._id, {
        date: row._id,
        collected: row.collected || 0,
        deposited: 0,
        deliveries: row.deliveries || 0,
      });
    }
    for (const row of depositedByDay as any[]) {
      const existing = byDate.get(row._id);
      if (existing) existing.deposited = row.deposited || 0;
      else
        byDate.set(row._id, {
          date: row._id,
          collected: 0,
          deposited: row.deposited || 0,
          deliveries: 0,
        });
    }

    const daily = Array.from(byDate.values()).sort((a, b) =>
      a.date < b.date ? 1 : -1,
    );

    const todayKey = new Date().toISOString().slice(0, 10);
    const today = byDate.get(todayKey);

    res.json({
      success: true,
      data: {
        cashInHand,
        totalCollected,
        totalDeposited,
        today: {
          collected: today?.collected || 0,
          deposited: today?.deposited || 0,
        },
        daily,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/mobile/driver/cash/deposits  body: { amount, note? }
// Driver self-logs handing cash over to the office. Balance updates
// immediately — capped at the driver's current cash-in-hand.
export const createCashDeposit = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = new mongoose.Types.ObjectId(req.driver!.id);
    const { amount, note } = req.body as { amount?: number; note?: string };

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      throw new AppError("Enter a valid deposit amount.", 400);
    }

    const [collectedAgg, depositedAgg] = await Promise.all([
      Booking.aggregate([
        { $match: codCollectedMatch(driverId) },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      DriverCashDeposit.aggregate([
        { $match: { driver: driverId } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    const cashInHand =
      (collectedAgg[0]?.total || 0) - (depositedAgg[0]?.total || 0);

    if (amt > cashInHand + 0.01) {
      throw new AppError(
        `Amount exceeds your cash in hand (₹${cashInHand.toFixed(2)}).`,
        400,
      );
    }

    const deposit = await DriverCashDeposit.create({
      driver: driverId,
      amount: amt,
      note: note?.trim() || undefined,
    });

    res.status(201).json({ success: true, data: deposit });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/driver/cash/deposits
// Recent deposit log entries for this driver.
export const listCashDeposits = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    const deposits = await DriverCashDeposit.find({ driver: driverId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: deposits });
  } catch (error) {
    next(error);
  }
};
