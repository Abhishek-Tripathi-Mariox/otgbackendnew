import { Router } from "express";
import {
  createQuotation,
  listMyQuotations,
  getMyQuotation,
  setMyQuotationStatus,
  listQuotations,
  getQuotation,
  respondToQuotation,
  updateQuotationStatus,
  assignVendorToQuotation,
  listVendorQuotations,
  getVendorQuotation,
  deleteQuotation,
  quotationCounts,
} from "../controllers/quotation.controller";
import { authenticate } from "../middlewares/auth.middleware";
import {
  authenticateUser,
  optionalAuthenticateUser,
} from "../middlewares/userAuth.middleware";
import { authenticateVendor } from "../middlewares/vendorAuth.middleware";

const router = Router();

// ===== Customer (mobile) routes =====
// Submission is allowed without auth (guest), but if a token is present we link to the user.
router.post("/", optionalAuthenticateUser, createQuotation);

// "My" routes require auth
router.get("/me", authenticateUser, listMyQuotations);
router.get("/me/:id", authenticateUser, getMyQuotation);
router.patch("/me/:id/status", authenticateUser, setMyQuotationStatus);

// ===== Vendor routes (assigned quotations) =====
router.get("/vendor/assigned", authenticateVendor, listVendorQuotations);
router.get("/vendor/assigned/:id", authenticateVendor, getVendorQuotation);

// ===== Admin routes =====
router.get("/", authenticate, listQuotations);
router.get("/counts", authenticate, quotationCounts);
router.get("/:id", authenticate, getQuotation);
router.patch("/:id/respond", authenticate, respondToQuotation);
router.patch("/:id/status", authenticate, updateQuotationStatus);
router.patch("/:id/assign-vendor", authenticate, assignVendorToQuotation);
router.delete("/:id", authenticate, deleteQuotation);

export default router;
