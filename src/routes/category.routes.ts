import { Router } from "express";
import {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  restoreCategory,
  permanentDeleteCategory,
  toggleCategoryStatus,
} from "../controllers/category.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { upload } from "../config/s3";

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/categories - Get all categories (with pagination, search, filters)
router.get("/", getCategories);

// GET /api/categories/:id - Get single category
router.get("/:id", getCategory);

// POST /api/categories - Create category (with image upload)
router.post("/", upload.single("image"), createCategory);

// PUT /api/categories/:id - Update category (with optional image upload)
router.put("/:id", upload.single("image"), updateCategory);

// DELETE /api/categories/:id - Soft delete category
router.delete("/:id", deleteCategory);

// PATCH /api/categories/:id/restore - Restore deleted category
router.patch("/:id/restore", restoreCategory);

// DELETE /api/categories/:id/permanent - Permanently delete category
router.delete("/:id/permanent", permanentDeleteCategory);

// PATCH /api/categories/:id/toggle-status - Toggle category status
router.patch("/:id/toggle-status", toggleCategoryStatus);

export default router;
