import { Router } from "express";
import {
  getPublicAppSettings,
  getAppSettings,
  updateAppSettings,
} from "../controllers/appSettings.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// ===== Public (customer app) =====
router.get("/public/settings", getPublicAppSettings);

// ===== Admin =====
router.get("/settings", authenticate, getAppSettings);
router.put("/settings", authenticate, updateAppSettings);

export default router;
