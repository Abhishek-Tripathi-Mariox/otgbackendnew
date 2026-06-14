import { Router } from "express";
import {
  listCmsPages,
  getCmsPageById,
  upsertCmsPage,
  updateCmsPage,
  deleteCmsPage,
  getCmsPageBySlug,
} from "../controllers/cmsPage.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// Public route (customer app) — must be declared before /:id
router.get("/public/:slug", getCmsPageBySlug);

// Admin routes
router.get("/", authenticate, listCmsPages);
router.post("/", authenticate, upsertCmsPage);
router.get("/:id", authenticate, getCmsPageById);
router.put("/:id", authenticate, updateCmsPage);
router.delete("/:id", authenticate, deleteCmsPage);

export default router;
