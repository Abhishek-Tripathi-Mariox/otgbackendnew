import { Response, NextFunction } from "express";
import Booking from "../models/Booking.model";
import Material from "../models/Material.model";
import User from "../models/User.model";
import { AppError } from "../middlewares/errorHandler";
import { UserRequest } from "../middlewares/userAuth.middleware";
import {
  evaluateOffer,
  findOfferByCode,
  resolveCart,
} from "../services/offerEngine";
import { recordOfferRedemption } from "./mobileOffers.controller";
import { findNearestVendorForMaterial } from "../utils/vendorAllocation";

const generateBookingId = async (): Promise<string> => {
  const count = await Booking.countDocuments();
  const timestamp = Date.now().toString().slice(-6);
  return `BK-${count + 1}-${timestamp}`;
};

/**
 * GET /api/mobile/orders
 * List the current user's bookings, sorted newest first.
 * Optional ?status=ongoing|past filters.
 */
export const listMyOrders = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const status = (req.query.status as string) || "all";

    const query: any = { user: userId, isDeleted: false };

    if (status === "ongoing") {
      query.status = { $in: ["pending", "confirmed", "in_transit"] };
    } else if (status === "past") {
      query.status = { $in: ["delivered", "cancelled"] };
    }

    const bookings = await Booking.find(query)
      .populate("material", "name images unit")
      .populate("vendor", "name mobile")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/mobile/orders/:id
 * Get a single booking belonging to the current user.
 */
export const getMyOrder = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    // Accept either the Mongo _id or the human-facing bookingId (e.g. "BK-12-345678")
    const raw = String(req.params.id || "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(raw);
    const orQuery: any[] = isObjectId
      ? [{ _id: raw }, { bookingId: raw.toUpperCase() }]
      : [{ bookingId: raw.toUpperCase() }];

    const booking = await Booking.findOne({
      user: userId,
      isDeleted: false,
      $or: orQuery,
    })
      .populate("material", "name images unit description")
      .populate("vendor", "name mobile email")
      .lean();

    if (!booking) throw new AppError("Order not found.", 404);

    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
};

interface CheckoutItem {
  materialId: string;
  quantity: number;
}

/**
 * POST /api/mobile/orders
 * Create bookings from a cart payload. One Booking per cart line item.
 * Body: { items: [{ materialId, quantity }], paymentMethod?, site?, notes? }
 */
export const createOrderFromCart = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const { items, paymentMethod, site, notes, couponCode } = req.body as {
      items?: CheckoutItem[];
      paymentMethod?: string;
      site?: string;
      notes?: string;
      couponCode?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError("Cart is empty.", 400);
    }

    // Hydrate materials in one go and validate
    const materialIds = items.map(i => i.materialId);
    const materials = await Material.find({
      _id: { $in: materialIds },
      isDeleted: false,
      status: "active",
    });

    if (materials.length === 0) {
      throw new AppError("None of the cart items are available.", 400);
    }

    const matMap = new Map(materials.map(m => [m._id.toString(), m]));

    // Evaluate the coupon (if any) once against the full cart so we can
    // distribute the discount across the bookings proportionally.
    let totalDiscount = 0;
    let offerForRedemption: any = null;
    if (couponCode) {
      const offer = await findOfferByCode(couponCode);
      if (!offer) throw new AppError("Invalid coupon code.", 400);
      const resolved = await resolveCart(items);
      const evalRes = await evaluateOffer(offer, resolved, userId);
      if (!evalRes.valid) {
        throw new AppError(evalRes.reason || "Coupon could not be applied.", 400);
      }
      totalDiscount = evalRes.discountAmount;
      offerForRedemption = offer;
    }

    // Pre-compute each line's gross total so we can split totalDiscount fairly
    const lines = items
      .map(it => {
        const m = matMap.get(it.materialId);
        if (!m) return null;
        const quantity = Math.max(m.minOrderQty || 1, Number(it.quantity) || 1);
        const price = m.finalSellingPrice ?? m.sellingPrice ?? 0;
        return { material: m, quantity, price, gross: price * quantity };
      })
      .filter(Boolean) as Array<{
      material: any;
      quantity: number;
      price: number;
      gross: number;
    }>;
    const grossTotal = lines.reduce((s, l) => s + l.gross, 0) || 1;

    // Resolve customer coordinates once, so each line can attempt
    // auto-allocation to the nearest stocking vendor in range.
    const userDoc = await User.findById(userId)
      .select("address.location.coordinates")
      .lean();
    const customerCoords =
      (userDoc?.address?.location?.coordinates as
        | [number, number]
        | undefined) || null;

    const created = [] as any[];
    let discountAllocated = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      // Last line absorbs rounding so the total discount matches exactly
      const lineDiscount =
        idx === lines.length - 1
          ? Math.max(0, totalDiscount - discountAllocated)
          : Math.round(
              ((line.gross / grossTotal) * totalDiscount) * 100,
            ) / 100;
      discountAllocated += lineDiscount;

      const totalAmount = Math.max(0, line.gross - lineDiscount);
      const bookingId = await generateBookingId();

      // Auto-allocate to nearest stocking vendor within radius
      const autoVendor = await findNearestVendorForMaterial(
        line.material._id,
        customerCoords,
      );

      const booking = await Booking.create({
        bookingId,
        user: userId,
        material: line.material._id,
        vendor: autoVendor || undefined,
        quantity: line.quantity,
        unit: line.material.unit,
        price: line.price,
        totalAmount,
        site,
        notes,
        paymentMethod,
        createdBy: userId,
      });

      const populated = await Booking.findById(booking._id)
        .populate("material", "name images unit")
        .lean();
      created.push(populated);
    }

    if (created.length === 0) {
      throw new AppError("Could not create any orders from the cart.", 400);
    }

    // Record redemption (one per checkout, not per booking)
    if (offerForRedemption && totalDiscount > 0) {
      await recordOfferRedemption(
        offerForRedemption._id.toString(),
        userId,
        created[0]?._id?.toString() || null,
        totalDiscount,
      );
    }

    res.status(201).json({
      success: true,
      message: `${created.length} order(s) placed successfully.`,
      data: created,
      discountApplied: totalDiscount,
    });
  } catch (error) {
    next(error);
  }
};
