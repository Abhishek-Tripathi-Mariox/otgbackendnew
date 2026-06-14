import { Router } from "express";
import {
  adminListReviews,
  adminReplyReview,
  adminDeleteReview,
} from "../controllers/mobileReview.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// ===== Admin moderation (all protected) =====
router.get("/", authenticate, adminListReviews);
router.patch("/:id/reply", authenticate, adminReplyReview);
router.delete("/:id", authenticate, adminDeleteReview);

export default router;
