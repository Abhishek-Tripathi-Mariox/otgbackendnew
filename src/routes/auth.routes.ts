import { Router } from "express";
import {
  login,
  getProfile,
  changePassword,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/profile", authenticate, getProfile);
router.put("/change-password", authenticate, changePassword);

export default router;
