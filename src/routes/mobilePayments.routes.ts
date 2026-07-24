import { Router } from "express";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "../controllers/payments.controller";
import { authenticateUser } from "../middlewares/userAuth.middleware";

const router = Router();

router.use(authenticateUser);

router.post("/razorpay-order", createRazorpayOrder);
router.post("/verify", verifyRazorpayPayment);

export default router;
