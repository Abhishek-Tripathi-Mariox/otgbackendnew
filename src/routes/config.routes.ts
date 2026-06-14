import { Router } from "express";
import {
  getAllConfigs,
  getConfig,
  updateConfig,
  toggleConfigStatus,
} from "../controllers/config.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getAllConfigs);
router.get("/:service", getConfig);
router.put("/:service", updateConfig);
router.patch("/:service/toggle", toggleConfigStatus);

export default router;
