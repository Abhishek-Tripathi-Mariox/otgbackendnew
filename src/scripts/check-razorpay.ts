import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/database";
import { getRazorpayCreds, createOrder } from "../services/razorpayService";

// Read-only-ish diagnostic (creates one ₹1 TEST-mode order, nothing is
// actually charged). Never prints the key secret / webhook secret.
const run = async () => {
  await connectDB();

  const creds = await getRazorpayCreds();
  if (!creds) {
    console.log(
      "NOT CONFIGURED: no active Config doc for service='razorpay' with both keyId and keySecret set.",
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  const mode = creds.keyId.startsWith("rzp_test_")
    ? "TEST"
    : creds.keyId.startsWith("rzp_live_")
      ? "LIVE"
      : "UNKNOWN (unexpected keyId prefix)";
  console.log(`Config found: keyId="${creds.keyId}" mode=${mode}`);
  console.log(`webhookSecret set: ${Boolean(creds.webhookSecret && creds.webhookSecret.trim())}`);

  console.log("\nCreating a real ₹1 test order against the Razorpay API...");
  const order = await createOrder(1, `diagnostic_${Date.now()}`, { purpose: "diagnostic-check" });

  if (!order) {
    console.log(
      "FAIL: createOrder() returned null — either the Key ID/Key Secret are wrong/rejected by Razorpay, or the API call errored. Check server logs above (razorpayService logs the real error) for the exact reason.",
    );
  } else {
    console.log(`SUCCESS: Razorpay accepted the credentials and created order id="${order.id}" amount=${order.amount} currency=${order.currency}`);
    console.log("(This was a real API call in TEST mode — no real money involved, and this order will simply expire unused.)");
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
