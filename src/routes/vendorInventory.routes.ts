import { Router } from "express";
import {
  listCategories,
  listSubCategories,
  listMaterials,
  listMyMaterials,
  getInventorySummary,
  addMyMaterial,
  updateMyMaterial,
  removeMyMaterial,
} from "../controllers/vendorInventory.controller";
import { authenticateVendor } from "../middlewares/vendorAuth.middleware";

const router = Router();

router.use(authenticateVendor);

// Catalog browsing
router.get("/categories", listCategories);
router.get("/categories/:id/subcategories", listSubCategories);
router.get("/materials", listMaterials);

// Vendor's own inventory
router.get("/summary", getInventorySummary);
router.get("/my-materials", listMyMaterials);
router.post("/my-materials", addMyMaterial);
router.patch("/my-materials/:id", updateMyMaterial);
router.delete("/my-materials/:id", removeMyMaterial);

export default router;
