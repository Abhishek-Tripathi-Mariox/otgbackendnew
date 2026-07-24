import { Response, NextFunction } from "express";
import { IPaymentDocument } from "../models/Payment.model";
import Payment from "../models/Payment.model";
import Transaction from "../models/Transaction.model";
import { AppError } from "../middlewares/errorHandler";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { AuthRequest } from "../types";
import {
  CheckoutItem,
  computeCartPricing,
  createBookingsFromPricing,
} from "./mobileOrders.controller";
import {
  createOrder,
  getRazorpayCreds,
  verifySignature,
} from "../services/razorpayService";

interface CartSnapshot {
  items?: CheckoutItem[];
  gstAmounts?: Record<string, number>;
  site?: string;
  notes?: string;
  pincode?: string;
  couponCode?: string;
  paymentMethod?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates the Booking(s) for an already-paid Razorpay order, from the cart
 * snapshot taken at order-creation time — NOT from anything a client resends
 * — so this is safe to call from either the client-side /verify callback or
 * the server-to-server webhook, whichever arrives first.
 *
 * The client /verify call and the Razorpay webhook can both arrive within
 * milliseconds of each other, so a plain "if no bookings yet, create them"
 * check is NOT safe — both callers would read "empty" and both would create
 * a duplicate set of bookings. `bookingsClaimed` is flipped false->true via
 * a single atomic findOneAndUpdate, so only one caller ever proceeds past
 * this point; the other waits briefly and returns whatever the winner
 * produced. If the winner fails partway through, the claim is released so a
 * retry (e.g. a webhook redelivery) can attempt again.
 */
export const finalizeBookingsForPayment = async (
  payment: IPaymentDocument,
): Promise<any[]> => {
  if (payment.bookings?.length) {
    return payment.bookings as any[];
  }

  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, bookingsClaimed: { $ne: true } },
    { $set: { bookingsClaimed: true } },
  );

  if (!claimed) {
    // Another caller is already finalizing (or already finished) this
    // payment — poll briefly for it to land instead of creating a duplicate.
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      const fresh = await Payment.findById(payment._id);
      if (fresh?.bookings?.length) return fresh.bookings as any[];
    }
    return [];
  }

  try {
    const snapshot = (payment.cartSnapshot || {}) as CartSnapshot;
    const userId = String(payment.user);

    const pricing = await computeCartPricing(userId, {
      items: snapshot.items,
      gstAmounts: snapshot.gstAmounts,
      site: snapshot.site,
      pincode: snapshot.pincode,
      couponCode: snapshot.couponCode,
    });

    const created = await createBookingsFromPricing(userId, pricing, {
      paymentMethod: snapshot.paymentMethod,
      site: snapshot.site,
      notes: snapshot.notes,
      paymentGateway: "razorpay",
      razorpayOrderId: payment.razorpayOrderId,
      paymentStatus: "completed",
    });

    payment.bookings = created.map((b: any) => b._id);
    await payment.save();

    for (const booking of created) {
      await Transaction.create({
        booking: booking._id,
        user: userId,
        amount: booking.totalAmount,
        currency: "INR",
        mode: "other",
        type: "payment",
        status: "settled",
        description: "Razorpay payment",
        meta: {
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
        },
      });
    }

    return created;
  } catch (error) {
    // Release the claim so a retry (e.g. webhook redelivery) can attempt
    // finalizing this payment again instead of it being stuck unfinalized.
    await Payment.updateOne({ _id: payment._id }, { $set: { bookingsClaimed: false } });
    throw error;
  }
};

/**
 * POST /api/mobile/payments/razorpay-order
 * Prices the cart server-side and, if Razorpay is configured, creates a
 * Razorpay order for it. If Razorpay isn't configured/enabled, responds
 * `configured:false` (200, not an error) so the client falls back to
 * booking the order directly, exactly like today's COD flow.
 */
export const createRazorpayOrder = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const { items, site, notes, pincode, couponCode, gstAmounts, paymentMethod } =
      req.body as CartSnapshot;

    const pricing = await computeCartPricing(userId, {
      items,
      gstAmounts,
      site,
      pincode,
      couponCode,
    });

    const creds = await getRazorpayCreds();
    if (!creds) {
      res.json({ success: true, data: { configured: false } });
      return;
    }

    const receipt = `cart_${userId}_${Date.now()}`;
    const order = await createOrder(pricing.grandTotal, receipt, {
      userId: String(userId),
    });

    if (!order) {
      // Razorpay is configured but the API call itself failed — degrade the
      // same way as "not configured" rather than blocking checkout.
      res.json({ success: true, data: { configured: false } });
      return;
    }

    await Payment.create({
      razorpayOrderId: order.id,
      user: userId,
      amount: pricing.grandTotal,
      currency: order.currency,
      status: "created",
      cartSnapshot: { items, gstAmounts, site, notes, pincode, couponCode, paymentMethod },
      attempts: [{ at: new Date(), event: "order_created", payload: order }],
    });

    res.json({
      success: true,
      data: {
        configured: true,
        razorpayOrderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: creds.keyId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/mobile/payments/verify
 * Verifies the Razorpay checkout callback signature and, only on success,
 * creates the Booking(s) for the cart from the snapshot taken at
 * order-creation time — bookings are never created before payment is
 * confirmed, so an abandoned Razorpay checkout leaves no order behind.
 */
export const verifyRazorpayPayment = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new AppError("Missing payment verification details.", 400);
    }

    const payment = await Payment.findOne({ razorpayOrderId, user: userId });
    if (!payment) throw new AppError("Payment record not found.", 404);

    const creds = await getRazorpayCreds();
    if (!creds) throw new AppError("Razorpay is not configured.", 400);

    const valid = verifySignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      creds.keySecret,
    );

    if (!valid) {
      payment.status = "failed";
      payment.failureReason = "Signature verification failed";
      payment.attempts.push({
        at: new Date(),
        event: "verify_failed",
        payload: { razorpayPaymentId },
      });
      await payment.save();
      throw new AppError("Payment verification failed.", 400);
    }

    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.status = "paid";
    payment.attempts.push({
      at: new Date(),
      event: "verified",
      payload: { razorpayPaymentId },
    });
    await payment.save();

    const created = await finalizeBookingsForPayment(payment);

    res.status(201).json({
      success: true,
      message: `${created.length} order(s) placed successfully.`,
      data: created,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/payments/logs — admin-facing paginated list of Razorpay payment
 * attempts (includes abandoned/never-completed ones with no Transaction).
 */
export const getPaymentLogs = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      fromDate,
      toDate,
      search = "",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status && status !== "all") query.status = status;

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
        { razorpayOrderId: { $regex: s, $options: "i" } },
        { razorpayPaymentId: { $regex: s, $options: "i" } },
      ];
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate("user", "name mobile email")
        .populate("bookings", "bookingId totalAmount status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Payment.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: payments,
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

export const getPaymentLog = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate("user", "name mobile email")
      .populate("bookings", "bookingId totalAmount status paymentStatus");

    if (!payment) throw new AppError("Payment log not found.", 404);

    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};
