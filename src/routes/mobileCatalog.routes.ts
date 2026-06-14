import { Router } from "express";
import {
  getCategories,
  getBrands,
  getSubCategories,
  getMaterials,
  getMaterialDetail,
  getBanners,
} from "../controllers/mobileCatalog.controller";
import {
  getMaterialReviews,
  createMaterialReview,
} from "../controllers/mobileReview.controller";
import { getPublicFaqs } from "../controllers/faq.controller";
import { authenticateUser } from "../middlewares/userAuth.middleware";

const router = Router();

// Public routes — no auth required

// GET /api/mobile/catalog/banners
router.get("/banners", getBanners);

// GET /api/mobile/catalog/categories
router.get("/categories", getCategories);

// GET /api/mobile/catalog/brands
router.get("/brands", getBrands);

// GET /api/mobile/catalog/categories/:id/subcategories
router.get("/categories/:id/subcategories", getSubCategories);

// GET /api/mobile/catalog/materials?category=&subCategory=&search=&page=&limit=
router.get("/materials", getMaterials);

// GET /api/mobile/catalog/materials/:id
router.get("/materials/:id", getMaterialDetail);

// Reviews & ratings for a material
// GET (public) list + stats; POST (auth) create/update own review
router.get("/materials/:id/reviews", getMaterialReviews);
router.post("/materials/:id/reviews", authenticateUser, createMaterialReview);

// GET /api/mobile/catalog/faqs?category= — public FAQs
router.get("/faqs", getPublicFaqs);

export default router;
