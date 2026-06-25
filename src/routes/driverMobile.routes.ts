import { Router } from "express";
import {
  sendOTP,
  verifyOTP,
  resendOTP,
  getMe,
  logout,
  updateProfileImage,
} from "../controllers/driverAuth.controller";
import {
  addVehicle,
  updateVehicle,
  deleteVehicle,
  saveOwner,
  savePersonal,
  saveDrivingLicense,
  saveBank,
  reuploadDrivingLicense,
  reuploadVehicleDocument,
  uploadDriverDocument,
} from "../controllers/driverOnboarding.controller";
import {
  getMyOrders,
  getMyOrder,
  updateOrderStatus,
  getDashboard,
  setOnlineStatus,
} from "../controllers/driverOrders.controller";
import {
  listDriverNotifications,
  getDriverUnreadCount,
  markAllDriverNotificationsRead,
  markDriverNotificationRead,
  deleteDriverNotification,
} from "../controllers/driverNotifications.controller";
import { authenticateDriver } from "../middlewares/driverAuth.middleware";
import { createUpload } from "../config/s3";

const router = Router();

// 5 MB cap is plenty for a profile photo and matches the platform default.
const profileImageUpload = createUpload("driver/profile", 5 * 1024 * 1024);

// Public auth
router.post("/auth/send-otp", sendOTP);
router.post("/auth/verify-otp", verifyOTP);
router.post("/auth/resend-otp", resendOTP);

// Authed
router.get("/auth/me", authenticateDriver, getMe);
router.post("/auth/logout", authenticateDriver, logout);
router.put(
  "/profile-image",
  authenticateDriver,
  profileImageUpload.single("image"),
  updateProfileImage,
);

// Vehicles (a driver can have many) — first POST also advances onboardingStep.
// Vehicle-owned documents (RC, insurance, pollution) are saved as part of the
// vehicle add/update payload under `documents: { rcBook, insurance, pollutionCertificate }`.
router.post("/vehicles", authenticateDriver, addVehicle);
router.put("/vehicles/:vehicleId", authenticateDriver, updateVehicle);
router.delete("/vehicles/:vehicleId", authenticateDriver, deleteVehicle);
router.post(
  "/vehicles/:vehicleId/documents/:docType/reupload",
  authenticateDriver,
  reuploadVehicleDocument,
);

// Generic document upload (image or PDF) → returns the S3 URL to store.
router.post("/documents/upload", authenticateDriver, uploadDriverDocument);

// Driver-owned info (each step advances onboardingStep)
router.post("/onboarding/personal", authenticateDriver, savePersonal);
router.post("/onboarding/owner", authenticateDriver, saveOwner);
router.post("/onboarding/bank", authenticateDriver, saveBank);

// Driving license (driver-owned doc, captured during the personal step)
router.post(
  "/documents/driving-license",
  authenticateDriver,
  saveDrivingLicense,
);
router.post(
  "/documents/driving-license/reupload",
  authenticateDriver,
  reuploadDrivingLicense,
);

// Notifications
router.get("/notifications", authenticateDriver, listDriverNotifications);
router.get(
  "/notifications/unread-count",
  authenticateDriver,
  getDriverUnreadCount,
);
router.patch(
  "/notifications/read-all",
  authenticateDriver,
  markAllDriverNotificationsRead,
);
router.patch(
  "/notifications/:id/read",
  authenticateDriver,
  markDriverNotificationRead,
);
router.delete(
  "/notifications/:id",
  authenticateDriver,
  deleteDriverNotification,
);

// Orders + dashboard
router.get("/dashboard", authenticateDriver, getDashboard);
router.patch("/online", authenticateDriver, setOnlineStatus);
router.get("/orders", authenticateDriver, getMyOrders);
router.get("/orders/:bookingId", authenticateDriver, getMyOrder);
router.patch(
  "/orders/:bookingId/status",
  authenticateDriver,
  updateOrderStatus,
);

export default router;
