import { Router } from "express";
import {
  listMyOrders,
  getMyOrder,
  createOrderFromCart,
  getOrderTracking,
} from "../controllers/mobileOrders.controller";
import { authenticateUser } from "../middlewares/userAuth.middleware";

const router = Router();

router.use(authenticateUser);

router.get("/", listMyOrders);
router.get("/:id/tracking", getOrderTracking);
router.get("/:id", getMyOrder);
router.post("/", createOrderFromCart);

export default router;
