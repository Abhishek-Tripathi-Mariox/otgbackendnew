import { Router } from "express";
import {
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  toggleOfferStatus,
  deleteOffer,
  listRedemptions,
} from "../controllers/offer.controller";
import {
  authenticate,
  requirePermission,
} from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("offers", "view"), listOffers);
router.get("/:id", requirePermission("offers", "view"), getOffer);
router.get(
  "/:id/redemptions",
  requirePermission("offers", "view"),
  listRedemptions,
);
router.post("/", requirePermission("offers", "create"), createOffer);
router.put("/:id", requirePermission("offers", "edit"), updateOffer);
router.patch(
  "/:id/status",
  requirePermission("offers", "edit"),
  toggleOfferStatus,
);
router.delete("/:id", requirePermission("offers", "delete"), deleteOffer);

export default router;
