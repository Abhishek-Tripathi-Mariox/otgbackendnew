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
  uploadQuotationPdf,
} from "../controllers/quotation.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { createPdfUpload } from "../config/s3";
import {
  authenticateUser,
  optionalAuthenticateUser,
} from "../middlewares/userAuth.middleware";
import { authenticateVendor } from "../middlewares/vendorAuth.middleware";

const router = Router();
const quotationPdfUpload = createPdfUpload("quotations");

// ===== Customer (mobile) routes =====
// Submission is allowed without auth (guest), but if a token is present we link to the user.
// An optional PDF (e.g. a BOQ / requirement list) may be attached as "pdf".
router.post(
  "/",
  optionalAuthenticateUser,
  quotationPdfUpload.single("pdf"),
  createQuotation,
);

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
router.patch(
  "/:id/pdf",
  authenticate,
  quotationPdfUpload.single("pdf"),
  uploadQuotationPdf,
);
router.patch("/:id/status", authenticate, updateQuotationStatus);
router.patch("/:id/assign-vendor", authenticate, assignVendorToQuotation);
router.delete("/:id", authenticate, deleteQuotation);

export default router;
