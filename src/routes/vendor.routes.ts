import { Router } from "express";
import {
  getVendors,
  getVendor,
  getVendorsByLocation,
  createVendor,
  updateVendor,
  deleteVendor,
  restoreVendor,
  permanentDeleteVendor,
  toggleVendorStatus,
  approveVendor,
  rejectVendor,
  getVendorMaterials,
  addVendorMaterial,
  updateVendorMaterial,
  removeVendorMaterial,
  toggleVendorMaterialAvailability,
  getStates,
} from "../controllers/vendorNew.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get states list
router.get("/states", getStates);

// Get vendors by location (geospatial)
router.get("/nearby", getVendorsByLocation);

// Get all vendors (with filters)
router.get("/", getVendors);

// Get single vendor
router.get("/:id", getVendor);

// Create vendor
router.post("/", createVendor);

// Update vendor
router.put("/:id", updateVendor);

// Soft delete vendor
router.delete("/:id", deleteVendor);

// Restore vendor
router.patch("/:id/restore", restoreVendor);

// Permanently delete vendor
router.delete("/:id/permanent", permanentDeleteVendor);

// Toggle vendor status
router.patch("/:id/toggle-status", toggleVendorStatus);

// Approve / reject a self-registered vendor
router.patch("/:id/approve", approveVendor);
router.patch("/:id/reject", rejectVendor);

// ==================== VENDOR MATERIALS ====================

// Get materials for a vendor
router.get("/:vendorId/materials", getVendorMaterials);

// Add material to vendor
router.post("/:vendorId/materials", addVendorMaterial);

// Update vendor material
router.put("/:vendorId/materials/:materialId", updateVendorMaterial);

// Remove material from vendor
router.delete("/:vendorId/materials/:materialId", removeVendorMaterial);

// Toggle vendor material availability
router.patch(
  "/:vendorId/materials/:materialId/toggle-availability",
  toggleVendorMaterialAvailability,
);

export default router;
