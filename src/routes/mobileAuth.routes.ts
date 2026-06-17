import { Router } from "express";
import {
  sendOTP,
  verifyOTP,
  resendOTP,
  getMe,
  updateProfile,
  updateFCMToken,
  logout,
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
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

// Saved addresses (address book)
router.get("/addresses", authenticateUser, listAddresses);
router.post("/addresses", authenticateUser, addAddress);
router.put("/addresses/:addrId", authenticateUser, updateAddress);
router.delete("/addresses/:addrId", authenticateUser, deleteAddress);

export default router;
