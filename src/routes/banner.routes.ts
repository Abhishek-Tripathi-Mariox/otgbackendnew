import { Router } from "express";
import {
  getBanners,
  getBanner,
  createBanner,
  updateBanner,
  deleteBanner,
  restoreBanner,
  permanentDeleteBanner,
  toggleBannerStatus,
  reorderBanners,
} from "../controllers/banner.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { createUpload } from "../config/s3";

const router = Router();
const bannerUpload = createUpload("banners");

// All routes require authentication
router.use(authenticate);

// GET /api/banners - Get all banners
router.get("/", getBanners);

// GET /api/banners/:id - Get single banner
router.get("/:id", getBanner);

// POST /api/banners - Create banner (with image upload)
router.post("/", bannerUpload.single("image"), createBanner);

// PUT /api/banners/:id - Update banner (with optional image upload)
router.put("/:id", bannerUpload.single("image"), updateBanner);

// DELETE /api/banners/:id - Soft delete banner
router.delete("/:id", deleteBanner);

// PATCH /api/banners/:id/restore - Restore deleted banner
router.patch("/:id/restore", restoreBanner);

// DELETE /api/banners/:id/permanent - Permanently delete banner
router.delete("/:id/permanent", permanentDeleteBanner);

// PATCH /api/banners/:id/toggle-status - Toggle banner status
router.patch("/:id/toggle-status", toggleBannerStatus);

// PATCH /api/banners/reorder - Reorder banners
router.patch("/reorder", reorderBanners);

export default router;
