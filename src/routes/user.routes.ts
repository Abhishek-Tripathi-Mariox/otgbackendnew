import { Router } from "express";
import {
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  restoreUser,
  permanentDeleteUser,
  toggleUserStatus,
  blockUser,
  unblockUser,
  getUserStats,
} from "../controllers/user.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get user stats
router.get("/stats", getUserStats);

// Get all users (with filters and pagination)
router.get("/", getUsers);

// Get single user
router.get("/:id", getUser);

// Update user (mobile cannot be changed)
router.put("/:id", updateUser);

// Soft delete user
router.delete("/:id", deleteUser);

// Restore deleted user
router.patch("/:id/restore", restoreUser);

// Permanently delete user
router.delete("/:id/permanent", permanentDeleteUser);

// Toggle user status
router.patch("/:id/toggle-status", toggleUserStatus);

// Block user
router.patch("/:id/block", blockUser);

// Unblock user
router.patch("/:id/unblock", unblockUser);

export default router;
