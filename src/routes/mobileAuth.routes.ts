import { Router } from "express";
import {
  sendOTP,
  verifyOTP,
  resendOTP,
  getMe,
  updateProfile,
  updateFCMToken,
  logout,
} from "../controllers/mobileAuth.controller";
import { authenticateUser } from "../middlewares/userAuth.middleware";

const router = Router();

// Public routes (no authentication required)
router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);

// Protected routes (authentication required)
router.get("/me", authenticateUser, getMe);
router.put("/profile", authenticateUser, updateProfile);
router.put("/fcm-token", authenticateUser, updateFCMToken);
router.post("/logout", authenticateUser, logout);

export default router;
