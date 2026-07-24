import { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/razorpayWebhook.controller";

const router = Router();

// No auth middleware — Razorpay calls this server-to-server. The HMAC
// signature verified inside the controller (against the raw body) is the
// authentication for this route.
router.post("/", handleRazorpayWebhook);

export default router;
