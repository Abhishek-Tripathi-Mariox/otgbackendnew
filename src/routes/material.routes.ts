import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { createUpload } from "../config/s3";
import {
  getMaterials,
  getMaterial,
  getMaterialsByCategory,
  getMaterialsBySubCategory,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  restoreMaterial,
  permanentDeleteMaterial,
  toggleMaterialStatus,
  getUnits,
} from "../controllers/materialNew.controller";

const router = Router();

// Create upload middleware for materials folder
const upload = createUpload("materials");

// All routes require authentication
router.use(authenticate);

// Get units list
router.get("/units", getUnits);

// Get all materials (with filters)
router.get("/", getMaterials);

// Get materials by category
router.get("/category/:categoryId", getMaterialsByCategory);

// Get materials by sub-category
router.get("/sub-category/:subCategoryId", getMaterialsBySubCategory);

// Get single material
router.get("/:id", getMaterial);

// Create material
router.post("/", upload.array("images", 5), createMaterial);

// Update material
router.put("/:id", upload.array("images", 5), updateMaterial);

// Soft delete material
router.delete("/:id", deleteMaterial);

// Restore material
router.patch("/:id/restore", restoreMaterial);

// Permanently delete material
router.delete("/:id/permanent", permanentDeleteMaterial);

// Toggle material status
router.patch("/:id/toggle-status", toggleMaterialStatus);

export default router;
