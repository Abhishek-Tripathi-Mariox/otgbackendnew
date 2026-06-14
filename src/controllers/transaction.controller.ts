import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.model";
import Booking from "../models/Booking.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

// List with filters + pagination
export const listTransactions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      mode,
      type,
      search = "",
      fromDate,
      toDate,
      vendor,
      user,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status && status !== "all") query.status = status;
    if (mode && mode !== "all") query.mode = mode;
    if (type && type !== "all") query.type = type;
    if (vendor) query.vendor = vendor;
    if (user) query.user = user;

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate as string);
      if (toDate) {
        const end = new Date(toDate as string);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const s = String(search);
      query.$or = [
        { transactionCode: { $regex: s, $options: "i" } },
        { reference: { $regex: s, $options: "i" } },
        { description: { $regex: s, $options: "i" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate("user", "name mobile email")
        .populate("vendor", "name business mobile")
        .populate("material", "name unit")
        .populate("booking", "bookingId totalAmount status paymentStatus")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Transaction.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: transactions,
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

// Stats — match the same filters as the list so the cards reflect what is shown
export const transactionStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status, mode, type, fromDate, toDate, search } = req.query;
    const baseQuery: any = {};
    if (status && status !== "all") baseQuery.status = status;
    if (mode && mode !== "all") baseQuery.mode = mode;
    if (type && type !== "all") baseQuery.type = type;
    if (fromDate || toDate) {
      baseQuery.createdAt = {};
      if (fromDate) baseQuery.createdAt.$gte = new Date(fromDate as string);
      if (toDate) {
        const end = new Date(toDate as string);
        end.setHours(23, 59, 59, 999);
        baseQuery.createdAt.$lte = end;
      }
    }
    if (search) {
      const s = String(search);
      baseQuery.$or = [
        { transactionCode: { $regex: s, $options: "i" } },
        { reference: { $regex: s, $options: "i" } },
        { description: { $regex: s, $options: "i" } },
      ];
    }

    const pipeline = [
      { $match: baseQuery },
      {
        $group: {
          _id: { status: "$status", type: "$type" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ];

    const rows = await Transaction.aggregate(pipeline as any);

    let settled = 0;
    let pending = 0;
    let refunds = 0;
    let failed = 0;
    let totalCount = 0;

    for (const r of rows) {
      totalCount += r.count;
      const { status: s, type: t } = r._id;
      if (t === "refund") {
        refunds += r.total;
        continue;
      }
      if (s === "settled") settled += r.total;
      else if (s === "pending" || s === "processing") pending += r.total;
      else if (s === "failed") failed += r.total;
    }

    res.json({
      success: true,
      data: {
        settled,
        pending,
        refunds,
        failed,
        count: totalCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get one
export const getTransaction = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const tx = await Transaction.findById(id)
      .populate("user", "name mobile email")
      .populate("vendor", "name business mobile email")
      .populate("material", "name unit")
      .populate("booking", "bookingId totalAmount status paymentStatus")
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");
    if (!tx) throw new AppError("Transaction not found", 404);
    res.json({ success: true, data: tx });
  } catch (error) {
    next(error);
  }
};

// Create — admin records a transaction. If bookingId is supplied, vendor/user/material
// are inferred from the booking.
export const createTransaction = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      bookingId,
      user,
      vendor,
      material,
      amount,
      mode,
      type,
      status,
      reference,
      description,
    } = req.body;

    if (amount === undefined || amount === null || amount === "") {
      throw new AppError("Amount is required", 400);
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0) {
      throw new AppError("Amount must be a non-negative number", 400);
    }

    const payload: any = {
      amount: numAmount,
      mode: mode || "other",
      type: type || "payment",
      status: status || "pending",
      reference: reference?.trim() || undefined,
      description: description?.trim() || undefined,
      createdBy: new mongoose.Types.ObjectId(req.admin!._id),
    };

    if (bookingId) {
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        // Allow lookup by bookingId code as well
        const byCode = await Booking.findOne({ bookingId });
        if (!byCode) throw new AppError("Booking not found", 404);
        payload.booking = byCode._id;
        payload.user = byCode.user;
        if (byCode.vendor) payload.vendor = byCode.vendor;
        if (byCode.material) payload.material = byCode.material;
      } else {
        const booking = await Booking.findById(bookingId);
        if (!booking) throw new AppError("Booking not found", 404);
        payload.booking = booking._id;
        payload.user = booking.user;
        if (booking.vendor) payload.vendor = booking.vendor;
        if (booking.material) payload.material = booking.material;
      }
    } else {
      if (user) payload.user = user;
      if (vendor) payload.vendor = vendor;
      if (material) payload.material = material;
    }

    const tx = await Transaction.create(payload);
    const populated = await Transaction.findById(tx._id)
      .populate("user", "name mobile email")
      .populate("vendor", "name business mobile")
      .populate("material", "name unit")
      .populate("booking", "bookingId totalAmount status paymentStatus")
      .populate("createdBy", "name email");

    res.status(201).json({
      success: true,
      message: "Transaction recorded",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// Update status
export const updateTransactionStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, failureReason } = req.body;
    if (!["pending", "processing", "settled", "failed"].includes(status)) {
      throw new AppError("Invalid status", 400);
    }
    const tx = await Transaction.findById(id);
    if (!tx) throw new AppError("Transaction not found", 404);

    tx.status = status;
    if (status === "failed") {
      tx.failureReason = failureReason || tx.failureReason;
    }
    tx.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await tx.save();

    const populated = await Transaction.findById(id)
      .populate("user", "name mobile email")
      .populate("vendor", "name business mobile")
      .populate("material", "name unit")
      .populate("booking", "bookingId totalAmount status paymentStatus");

    res.json({
      success: true,
      message: `Transaction marked as ${status}`,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// Delete
export const deleteTransaction = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const tx = await Transaction.findByIdAndDelete(id);
    if (!tx) throw new AppError("Transaction not found", 404);
    res.json({ success: true, message: "Transaction deleted" });
  } catch (error) {
    next(error);
  }
};
