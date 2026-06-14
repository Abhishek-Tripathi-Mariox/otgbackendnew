import { Router } from "express";
import {
  getAllStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  toggleStaffStatus,
  resetStaffPassword,
  getStaffMeta,
} from "../controllers/staff.controller";
import { authenticate, requirePermission } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/meta", getStaffMeta);
router.get("/", requirePermission("staff", "view"), getAllStaff);
router.get("/:id", requirePermission("staff", "view"), getStaff);
router.post("/", requirePermission("staff", "create"), createStaff);
router.put("/:id", requirePermission("staff", "edit"), updateStaff);
router.patch("/:id/status", requirePermission("staff", "edit"), toggleStaffStatus);
router.patch("/:id/reset-password", requirePermission("staff", "edit"), resetStaffPassword);
router.delete("/:id", requirePermission("staff", "delete"), deleteStaff);

export default router;
