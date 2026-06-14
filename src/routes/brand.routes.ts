import { Router } from "express";
import {
  getBrands,
  getBrand,
  createBrand,
  updateBrand,
  deleteBrand,
  restoreBrand,
  permanentDeleteBrand,
  toggleBrandStatus,
} from "../controllers/brand.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { upload } from "../config/s3";

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/brands - Get all brands (with pagination, search, filters)
router.get("/", getBrands);

// GET /api/brands/:id - Get single brand
router.get("/:id", getBrand);

// POST /api/brands - Create brand (with image upload)
router.post("/", upload.single("image"), createBrand);

// PUT /api/brands/:id - Update brand (with optional image upload)
router.put("/:id", upload.single("image"), updateBrand);

// DELETE /api/brands/:id - Soft delete brand
router.delete("/:id", deleteBrand);

// PATCH /api/brands/:id/restore - Restore deleted brand
router.patch("/:id/restore", restoreBrand);

// DELETE /api/brands/:id/permanent - Permanently delete brand
router.delete("/:id/permanent", permanentDeleteBrand);

// PATCH /api/brands/:id/toggle-status - Toggle brand status
router.patch("/:id/toggle-status", toggleBrandStatus);

export default router;
