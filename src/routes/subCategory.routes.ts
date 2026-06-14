import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { createUpload } from "../config/s3";
import {
  getSubCategories,
  getSubCategory,
  getSubCategoriesByCategory,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
  restoreSubCategory,
  permanentDeleteSubCategory,
  toggleSubCategoryStatus,
} from "../controllers/subCategory.controller";

const router = Router();

// Create upload middleware for sub-categories folder
const upload = createUpload("sub-categories");

// All routes require authentication
router.use(authenticate);

// Get all sub categories (with filters)
router.get("/", getSubCategories);

// Get sub categories by category
router.get("/category/:categoryId", getSubCategoriesByCategory);

// Get single sub category
router.get("/:id", getSubCategory);

// Create sub category
router.post("/", upload.single("image"), createSubCategory);

// Update sub category
router.put("/:id", upload.single("image"), updateSubCategory);

// Soft delete sub category
router.delete("/:id", deleteSubCategory);

// Restore sub category
router.patch("/:id/restore", restoreSubCategory);

// Permanently delete sub category
router.delete("/:id/permanent", permanentDeleteSubCategory);

// Toggle sub category status
router.patch("/:id/toggle-status", toggleSubCategoryStatus);

export default router;
