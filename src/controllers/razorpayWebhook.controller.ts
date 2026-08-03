import { Request, Response, NextFunction } from "express";
import Payment from "../models/Payment.model";
import Booking, { pushStatus } from "../models/Booking.model";
import { getRazorpayCreds, verifyWebhookSignature } from "../services/razorpayService";
import { finalizeBookingsForPayment } from "./payments.controller";
import { ensureInvoicesGenerated } from "../services/invoiceService";

/**
 * POST /api/webhooks/razorpay
 * Razorpay calls this directly (no user auth) — the HMAC signature over the
 * raw request body IS the authentication. Mounted in server.ts with its own
 * express.raw() parser, ahead of the global express.json(), so req.body here
 * is a Buffer, not a parsed object.
 *
 * This is the authoritative confirmation path: if the client-side /verify
 * call never lands (app closed mid-payment), this webhook is what actually
 * finalizes the booking, using the cart snapshot taken when the Razorpay
 * order was created.
 *
 * Always responds 200 once a delivery is accepted/processed so Razorpay
 * stops retrying; responds non-2xx only on a bad/missing signature.
 */
export const handleRazorpayWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-razorpay-signature"] as string | undefined;

    const creds = await getRazorpayCreds();

    if (!creds?.webhookSecret) {
      // Webhook secret not set up yet — we cannot verify authenticity of this
      // delivery, so acknowledge it but do NOT act on the payload (avoids
      // acting on a spoofed webhook while unconfigured).
      console.warn(
        "[razorpayWebhook] webhookSecret not configured — acknowledging without processing.",
      );
      res.status(200).json({ received: true, processed: false });
      return;
    }

    if (!signature || !verifyWebhookSignature(rawBody, signature, creds.webhookSecret)) {
      res.status(400).json({ success: false, message: "Invalid signature" });
      return;
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const eventName: string = event?.event || "unknown";
    const paymentEntity = event?.payload?.payment?.entity;
    const razorpayOrderId: string | undefined = paymentEntity?.order_id;
    const razorpayPaymentId: string | undefined = paymentEntity?.id;

    if (!razorpayOrderId) {
      res.status(200).json({ received: true, processed: false });
      return;
    }

    const payment = await Payment.findOne({ razorpayOrderId });
    if (!payment) {
      res.status(200).json({ received: true, processed: false });
      return;
    }

    // Idempotency: skip reacting twice to the same event+payment id
    // (Razorpay retries/duplicates webhook deliveries).
    const alreadyRecorded = payment.attempts.some(
      (a) => a.event === eventName && (a.payload as any)?.id === razorpayPaymentId,
    );

    if (!alreadyRecorded) {
      payment.attempts.push({ at: new Date(), event: eventName, payload: paymentEntity });
      await payment.save();

      if (eventName === "payment.captured" && payment.status !== "paid") {
        payment.razorpayPaymentId = razorpayPaymentId;
        payment.status = "paid";
        await payment.save();

        const created = await finalizeBookingsForPayment(payment);

        // If the client-side /verify call already created the bookings
        // (paymentStatus already "completed"), this is a no-op audit note;
        // otherwise this webhook is the one flipping them to completed.
        for (const booking of created) {
          if (booking.paymentStatus !== "completed") {
            const doc = await Booking.findById(booking._id);
            if (doc) {
              doc.paymentStatus = "completed";
              pushStatus(doc, doc.status, "Payment captured via Razorpay webhook");
              await doc.save();
              if (doc.status === "delivered") {
                ensureInvoicesGenerated(String(doc._id)).catch(() => {});
              }
            }
          }
        }
      } else if (eventName === "payment.failed" && payment.status !== "paid") {
        payment.status = "failed";
        payment.failureReason = paymentEntity?.error_description || "Payment failed";
        await payment.save();
      }
    }

    res.status(200).json({ received: true, processed: true });
  } catch (error) {
    next(error);
  }
};
