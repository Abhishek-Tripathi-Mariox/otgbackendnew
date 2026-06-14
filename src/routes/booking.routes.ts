import { Router } from "express";
import {
  getBookings,
  getBooking,
  createBooking,
  updateBooking,
  updateBookingStatus,
  allocateVendor,
  deleteBooking,
  getDashboardStats,
  getTopMaterials,
  getTopVendors,
  getRevenueTrend,
} from "../controllers/booking.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Dashboard statistics
router.get("/stats/dashboard", getDashboardStats);
router.get("/stats/revenue-trend", getRevenueTrend);
router.get("/stats/top-materials", getTopMaterials);
router.get("/stats/top-vendors", getTopVendors);

// Get all bookings
router.get("/", getBookings);

// Get single booking
router.get("/:id", getBooking);

// Create booking
router.post("/", createBooking);

// Update booking
router.put("/:id", updateBooking);

// Update booking status
router.patch("/:id/status", updateBookingStatus);

// Allocate vendor to booking (manual assignment)
router.patch("/:id/vendor", allocateVendor);

// Delete booking (soft delete)
router.delete("/:id", deleteBooking);

export default router;
