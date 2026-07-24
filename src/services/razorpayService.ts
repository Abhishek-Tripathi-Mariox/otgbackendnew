import crypto from "crypto";
import Razorpay from "razorpay";
import { isServiceReady } from "./configService";

export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

let cachedClient: Razorpay | null = null;
let cachedKeyId: string | null = null;

/**
 * Returns the admin-configured Razorpay credentials, or null if Razorpay is
 * not configured / not enabled. Never throws.
 */
export const getRazorpayCreds = async (): Promise<RazorpayCreds | null> => {
  const values = await isServiceReady("razorpay", ["keyId", "keySecret"]);
  if (!values) return null;
  return {
    keyId: values.keyId,
    keySecret: values.keySecret,
    webhookSecret: values.webhookSecret,
  };
};

export const isRazorpayConfigured = async (): Promise<boolean> =>
  Boolean(await getRazorpayCreds());

const getClient = (creds: RazorpayCreds): Razorpay => {
  if (cachedClient && cachedKeyId === creds.keyId) return cachedClient;
  cachedClient = new Razorpay({
    key_id: creds.keyId,
    key_secret: creds.keySecret,
  });
  cachedKeyId = creds.keyId;
  return cachedClient;
};

export interface RazorpayOrderResult {
  id: string;
  amount: number;
  currency: string;
}

/**
 * Creates a Razorpay order for the given amount (in rupees). Returns null if
 * Razorpay isn't configured, or if the Razorpay API call itself fails — the
 * caller must treat both cases as "not available right now" and fall back to
 * direct booking creation rather than erroring the checkout.
 */
export const createOrder = async (
  amountInRupees: number,
  receipt: string,
  notes?: Record<string, string>,
): Promise<RazorpayOrderResult | null> => {
  const creds = await getRazorpayCreds();
  if (!creds) return null;

  try {
    const client = getClient(creds);
    const order = await client.orders.create({
      amount: Math.round(amountInRupees * 100),
      currency: "INR",
      receipt,
      notes,
    });
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
    };
  } catch (error) {
    console.error("[razorpayService] createOrder failed:", error);
    return null;
  }
};

// Constant-time comparison — a plain `===` on hex digests leaks timing
// information proportional to how many leading characters match, which is a
// standard side-channel weakness for HMAC/signature verification. Length is
// checked first since timingSafeEqual throws (rather than returning false)
// on mismatched buffer lengths.
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verifies the client-side checkout callback signature Razorpay's SDK
 * returns after a successful payment: HMAC-SHA256 of "orderId|paymentId"
 * keyed by the merchant's key secret.
 */
export const verifySignature = (
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean => {
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqual(expected, signature);
};

/**
 * Verifies a Razorpay webhook delivery: HMAC-SHA256 of the raw request body
 * keyed by the webhook secret (distinct formula from verifySignature above —
 * do not conflate the two).
 */
export const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string,
  webhookSecret: string,
): boolean => {
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return safeEqual(expected, signature);
};
