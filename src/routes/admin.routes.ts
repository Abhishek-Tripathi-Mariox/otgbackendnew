import { Router } from "express";
import {
  getAllAdmins,
  getAdminById,
  createSubAdmin,
  updateSubAdmin,
  deleteSubAdmin,
  updatePermissions,
} from "../controllers/admin.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get("/", authorize("admin:read"), getAllAdmins);
router.get("/:id", authorize("admin:read"), getAdminById);
router.post("/", authorize("admin:write"), createSubAdmin);
router.put("/:id", authorize("admin:write"), updateSubAdmin);
router.delete("/:id", authorize("admin:delete"), deleteSubAdmin);
router.patch("/:id/permissions", authorize("admin:write"), updatePermissions);

export default router;
