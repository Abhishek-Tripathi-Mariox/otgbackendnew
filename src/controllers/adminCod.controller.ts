import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Booking, { COD_PAYMENT_METHOD_REGEX } from "../models/Booking.model";
import DriverCashDeposit from "../models/DriverCashDeposit.model";
import Driver from "../models/Driver.model";
import { AuthRequest } from "../types";

// GET /api/admin/cod/reconciliation
// Admin-wide COD reconciliation (D17): how much cash every driver has
// collected from COD deliveries, how much they've deposited back to the
// office, and what's still outstanding — grouped per driver plus an overall
// total. Mirrors driverCash.controller.ts's per-driver aggregation, just
// grouped by driver instead of scoped to the requesting driver.
export const getCodReconciliation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [collectedByDriver, depositedByDriver] = await Promise.all([
      Booking.aggregate([
        {
          $match: {
            driver: { $ne: null },
            isDeleted: false,
            status: "delivered",
            paymentMethod: COD_PAYMENT_METHOD_REGEX,
          },
        },
        {
          $group: {
            _id: "$driver",
            collected: { $sum: "$totalAmount" },
            deliveries: { $sum: 1 },
          },
        },
      ]),
      DriverCashDeposit.aggregate([
        {
          $group: {
            _id: "$driver",
            deposited: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const depositedMap = new Map<string, number>();
    for (const row of depositedByDriver as any[]) {
      depositedMap.set(String(row._id), row.deposited || 0);
    }

    const driverIds = new Set<string>();
    collectedByDriver.forEach((r: any) => driverIds.add(String(r._id)));
    depositedByDriver.forEach((r: any) => driverIds.add(String(r._id)));

    const drivers = await Driver.find({
      _id: { $in: Array.from(driverIds).map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("name mobile")
      .lean();
    const driverMap = new Map(drivers.map((d) => [String(d._id), d]));

    const collectedMap = new Map<string, {collected: number; deliveries: number}>();
    for (const row of collectedByDriver as any[]) {
      collectedMap.set(String(row._id), {
        collected: row.collected || 0,
        deliveries: row.deliveries || 0,
      });
    }

    const rows = Array.from(driverIds).map((id) => {
      const collected = collectedMap.get(id)?.collected || 0;
      const deliveries = collectedMap.get(id)?.deliveries || 0;
      const deposited = depositedMap.get(id) || 0;
      const cashInHand = Math.max(0, +(collected - deposited).toFixed(2));
      const driver = driverMap.get(id);
      return {
        driverId: id,
        driverName: driver?.name || "Unknown driver",
        driverMobile: driver?.mobile || "",
        collected,
        deposited,
        cashInHand,
        deliveries,
      };
    });

    rows.sort((a, b) => b.cashInHand - a.cashInHand);

    const totals = rows.reduce(
      (acc, r) => ({
        collected: acc.collected + r.collected,
        deposited: acc.deposited + r.deposited,
        cashInHand: acc.cashInHand + r.cashInHand,
        deliveries: acc.deliveries + r.deliveries,
      }),
      { collected: 0, deposited: 0, cashInHand: 0, deliveries: 0 },
    );

    res.json({ success: true, data: { totals, drivers: rows } });
  } catch (error) {
    next(error);
  }
};
