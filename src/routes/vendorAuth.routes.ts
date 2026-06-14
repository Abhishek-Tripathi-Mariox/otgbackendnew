import { Router } from "express";
import {
  sendOTP,
  verifyOTP,
  resendOTP,
  getMe,
  updateMe,
  logout,
  listVendorNotifications,
  getVendorUnreadCount,
  markAllVendorNotificationsRead,
  markVendorNotificationRead,
  deleteVendorNotification,
  getVendorHelpSettings,
  createVendorSupportTicket,
  listVendorSupportTickets,
  getVendorDashboard,
  saveBusinessStep,
  saveCategoriesStep,
  submitDocumentsStep,
} from "../controllers/vendorAuth.controller";
import { authenticateVendor } from "../middlewares/vendorAuth.middleware";

const router = Router();

// Public routes
router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);

// Protected — profile
router.get("/me", authenticateVendor, getMe);
router.put("/me", authenticateVendor, updateMe);
router.post("/logout", authenticateVendor, logout);

// Protected — registration/onboarding steps (each advances onboardingStep)
router.post("/onboarding/business", authenticateVendor, saveBusinessStep);
router.post("/onboarding/categories", authenticateVendor, saveCategoriesStep);
router.post("/onboarding/documents", authenticateVendor, submitDocumentsStep);

// Protected — notifications
router.get("/notifications", authenticateVendor, listVendorNotifications);
router.get(
  "/notifications/unread-count",
  authenticateVendor,
  getVendorUnreadCount,
);
router.patch(
  "/notifications/read-all",
  authenticateVendor,
  markAllVendorNotificationsRead,
);
router.patch(
  "/notifications/:id/read",
  authenticateVendor,
  markVendorNotificationRead,
);
router.delete("/notifications/:id", authenticateVendor, deleteVendorNotification);

// Protected — dashboard
router.get("/dashboard", authenticateVendor, getVendorDashboard);

// Protected — support & help
router.get("/help-settings", authenticateVendor, getVendorHelpSettings);
router.post("/support", authenticateVendor, createVendorSupportTicket);
router.get("/support", authenticateVendor, listVendorSupportTickets);

export default router;
