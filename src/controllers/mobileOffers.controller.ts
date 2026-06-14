import { Response, NextFunction } from "express";
import Offer from "../models/Offer.model";
import OfferRedemption from "../models/OfferRedemption.model";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { AppError } from "../middlewares/errorHandler";
import {
  evaluateOffer,
  findOfferByCode,
  resolveCart,
} from "../services/offerEngine";

/**
 * GET /api/mobile/offers
 * Returns offers the user can see — active, in their date window,
 * and either scope!=user OR they're in the allowed users list.
 * Includes auto-apply flag so the cart can highlight them.
 */
export const listAvailableOffers = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const now = new Date();
    const offers = await Offer.find({
      status: "active",
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    // Hide user-scoped offers that don't include this user
    const visible = offers.filter((o) => {
      if (o.scope !== "user") return true;
      if (!userId) return false;
      return (o.users || []).some((u: any) => u.toString() === userId);
    });

    res.json({ success: true, data: visible });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/mobile/offers/validate
 * Body: { code, items: [{materialId, quantity}] }
 * Returns the discount that would apply for this cart + user.
 */
export const validateOffer = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { code, items } = req.body as {
      code?: string;
      items?: { materialId: string; quantity: number }[];
    };
    if (!code) throw new AppError("Coupon code is required.", 400);
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError("Cart is empty.", 400);
    }

    const offer = await findOfferByCode(code);
    if (!offer) {
      res.json({
        success: true,
        data: {
          valid: false,
          reason: "Invalid coupon code.",
          discountAmount: 0,
        },
      });
      return;
    }

    const cart = await resolveCart(items);
    if (cart.length === 0) {
      res.json({
        success: true,
        data: {
          valid: false,
          reason: "No valid items in cart.",
          discountAmount: 0,
        },
      });
      return;
    }

    const evaluation = await evaluateOffer(offer, cart, req.user?.id);
    res.json({
      success: true,
      data: {
        valid: evaluation.valid,
        reason: evaluation.reason,
        discountAmount: evaluation.discountAmount,
        freeDelivery: evaluation.freeDelivery,
        eligibleSubtotal: evaluation.eligibleSubtotal,
        offer: {
          _id: offer._id,
          code: offer.code,
          title: offer.title,
          description: offer.description,
          discountType: offer.discountType,
          discountValue: offer.discountValue,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Internal helper used by order creation to record an offer redemption.
 * Not an HTTP handler.
 */
export const recordOfferRedemption = async (
  offerId: string,
  userId: string,
  bookingId: string | null,
  discountApplied: number,
): Promise<void> => {
  await OfferRedemption.create({
    offer: offerId,
    user: userId,
    booking: bookingId,
    discountApplied,
  });
  await Offer.findByIdAndUpdate(offerId, { $inc: { usageCount: 1 } });
};
