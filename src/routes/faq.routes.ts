import { Router } from "express";
import {
  adminListFaqs,
  adminCreateFaq,
  adminUpdateFaq,
  adminDeleteFaq,
} from "../controllers/faq.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// ===== Admin (all protected) =====
router.get("/", authenticate, adminListFaqs);
router.post("/", authenticate, adminCreateFaq);
router.put("/:id", authenticate, adminUpdateFaq);
router.delete("/:id", authenticate, adminDeleteFaq);

export default router;
