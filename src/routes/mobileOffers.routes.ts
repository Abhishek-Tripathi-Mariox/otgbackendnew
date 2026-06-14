import { Router } from "express";
import {
  listAvailableOffers,
  validateOffer,
} from "../controllers/mobileOffers.controller";
import {
  authenticateUser,
  optionalAuthenticateUser,
} from "../middlewares/userAuth.middleware";

const router = Router();

router.get("/", optionalAuthenticateUser, listAvailableOffers);
router.post("/validate", authenticateUser, validateOffer);

export default router;
