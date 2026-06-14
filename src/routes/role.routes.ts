import { Router } from "express";
import {
  getAllRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getRoleMeta,
} from "../controllers/role.controller";
import { authenticate, requirePermission } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/meta", getRoleMeta);
router.get("/", requirePermission("roles", "view"), getAllRoles);
router.get("/:id", requirePermission("roles", "view"), getRole);
router.post("/", requirePermission("roles", "create"), createRole);
router.put("/:id", requirePermission("roles", "edit"), updateRole);
router.delete("/:id", requirePermission("roles", "delete"), deleteRole);

export default router;
