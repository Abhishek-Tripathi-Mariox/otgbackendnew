import Material from "../models/Material.model";
import Offer, { IOfferDocument } from "../models/Offer.model";
import OfferRedemption from "../models/OfferRedemption.model";

export interface CartItemInput {
  materialId: string;
  quantity: number;
}

export interface ResolvedCartItem {
  materialId: string;
  quantity: number;
  unitPrice: number; // final selling price (incl GST)
  lineTotal: number; // unitPrice * quantity
  category?: string;
  subCategory?: string | null;
}

export interface OfferEvaluation {
  valid: boolean;
  reason?: string;
  offer?: IOfferDocument;
  discountAmount: number; // ₹ off the subtotal
  freeDelivery: boolean;
  eligibleSubtotal: number; // portion the offer applied to
}

/**
 * Hydrate cart items into priced rows with category/subCategory info.
 * Skips ids that don't exist or are inactive.
 */
export const resolveCart = async (
  items: CartItemInput[],
): Promise<ResolvedCartItem[]> => {
  if (!items?.length) return [];
  const ids = items.map((i) => i.materialId);
  const materials = await Material.find({
    _id: { $in: ids },
    isDeleted: false,
    status: "active",
  }).select("_id finalSellingPrice sellingPrice category subCategory minOrderQty");

  const map = new Map(materials.map((m) => [m._id.toString(), m]));
  return items
    .map((i) => {
      const m = map.get(i.materialId);
      if (!m) return null;
      const unitPrice = m.finalSellingPrice ?? m.sellingPrice ?? 0;
      const quantity = Math.max(m.minOrderQty || 1, Number(i.quantity) || 1);
      return {
        materialId: m._id.toString(),
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity,
        category: m.category?.toString(),
        subCategory: m.subCategory ? m.subCategory.toString() : null,
      } as ResolvedCartItem;
    })
    .filter(Boolean) as ResolvedCartItem[];
};

/**
 * Returns the line items that match a given offer's scope.
 * For scope=user, the offer applies to the whole cart provided the user is allowed
 * (checked in evaluateOffer).
 */
const filterEligibleItems = (
  cart: ResolvedCartItem[],
  offer: IOfferDocument,
): ResolvedCartItem[] => {
  switch (offer.scope) {
    case "category": {
      const allowed = new Set(
        (offer.categories || []).map((c) => c.toString()),
      );
      return cart.filter((i) => i.category && allowed.has(i.category));
    }
    case "subCategory": {
      const allowed = new Set(
        (offer.subCategories || []).map((s) => s.toString()),
      );
      return cart.filter(
        (i) => i.subCategory && allowed.has(i.subCategory),
      );
    }
    case "material": {
      const allowed = new Set(
        (offer.materials || []).map((m) => m.toString()),
      );
      return cart.filter((i) => allowed.has(i.materialId));
    }
    case "user":
    case "all":
    default:
      return cart;
  }
};

const isInWindow = (offer: IOfferDocument, now = new Date()): boolean => {
  if (offer.startsAt && now < offer.startsAt) return false;
  if (offer.endsAt && now > offer.endsAt) return false;
  return true;
};

/**
 * Pure-function evaluation: given an offer, cart, and user, decide whether it
 * applies and how much it saves. Also enforces all constraints.
 */
export const evaluateOffer = async (
  offer: IOfferDocument,
  cart: ResolvedCartItem[],
  userId?: string,
): Promise<OfferEvaluation> => {
  const base: OfferEvaluation = {
    valid: false,
    discountAmount: 0,
    freeDelivery: false,
    eligibleSubtotal: 0,
    offer,
  };

  if (offer.status !== "active") {
    return { ...base, reason: "Offer is inactive." };
  }
  if (!isInWindow(offer)) {
    return { ...base, reason: "Offer is not currently valid." };
  }

  // Scope=user: only listed users may redeem
  if (offer.scope === "user") {
    if (!userId) {
      return { ...base, reason: "Please log in to use this offer." };
    }
    const allowedUsers = (offer.users || []).map((u) => u.toString());
    if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
      return { ...base, reason: "This offer is not available for your account." };
    }
  }

  const eligible = filterEligibleItems(cart, offer);
  if (eligible.length === 0 && offer.discountType !== "free_delivery") {
    return { ...base, reason: "No eligible items in your cart for this offer." };
  }

  const eligibleSubtotal = eligible.reduce((s, i) => s + i.lineTotal, 0);
  const cartSubtotal = cart.reduce((s, i) => s + i.lineTotal, 0);

  if (
    offer.minOrderAmount &&
    offer.minOrderAmount > 0 &&
    cartSubtotal < offer.minOrderAmount
  ) {
    return {
      ...base,
      reason: `Add ₹${(
        offer.minOrderAmount - cartSubtotal
      ).toFixed(0)} more to use this offer.`,
    };
  }

  if (
    offer.globalUsageLimit &&
    offer.usageCount >= offer.globalUsageLimit
  ) {
    return { ...base, reason: "This offer has reached its usage limit." };
  }

  if (userId && offer.maxUsesPerUser && offer.maxUsesPerUser > 0) {
    const userUses = await OfferRedemption.countDocuments({
      offer: offer._id,
      user: userId,
    });
    if (userUses >= offer.maxUsesPerUser) {
      return { ...base, reason: "You've already used this offer." };
    }
  }

  // Compute discount
  let discount = 0;
  let freeDelivery = false;
  switch (offer.discountType) {
    case "percentage": {
      discount = (eligibleSubtotal * (offer.discountValue || 0)) / 100;
      if (offer.maxDiscount && discount > offer.maxDiscount) {
        discount = offer.maxDiscount;
      }
      break;
    }
    case "flat": {
      discount = Math.min(offer.discountValue || 0, eligibleSubtotal);
      break;
    }
    case "free_delivery": {
      freeDelivery = true;
      discount = 0; // delivery charges are deducted separately by caller
      break;
    }
    case "bogo": {
      const buyX = offer.buyX || 1;
      const getY = offer.getY || 1;
      // Sort eligible items by unitPrice ascending → freebies should be cheapest
      const expanded: number[] = [];
      for (const it of eligible) {
        for (let k = 0; k < it.quantity; k++) expanded.push(it.unitPrice);
      }
      expanded.sort((a, b) => a - b);
      const groupSize = buyX + getY;
      const fullGroups = Math.floor(expanded.length / groupSize);
      let freebies = fullGroups * getY;
      // freebies are the cheapest units in the eligible set
      while (freebies > 0 && expanded.length > 0) {
        discount += expanded.shift() || 0;
        freebies--;
      }
      break;
    }
  }

  if (discount < 0) discount = 0;
  if (discount > eligibleSubtotal) discount = eligibleSubtotal;

  return {
    valid: true,
    discountAmount: Math.round(discount * 100) / 100,
    freeDelivery,
    eligibleSubtotal,
    offer,
  };
};

/**
 * Lookup an offer by code (case-insensitive).
 */
export const findOfferByCode = async (
  code: string,
): Promise<IOfferDocument | null> => {
  if (!code) return null;
  return Offer.findOne({ code: code.toUpperCase().trim() });
};

/**
 * Returns all active, currently-valid auto-apply offers.
 */
export const listAutoApplyOffers = async (): Promise<IOfferDocument[]> => {
  const now = new Date();
  return Offer.find({
    status: "active",
    autoApply: true,
    $or: [{ startsAt: null }, { startsAt: { $lte: now } }],
    $and: [
      {
        $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
      },
    ],
  });
};
