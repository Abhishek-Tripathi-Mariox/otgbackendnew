import { Router } from "express";
import {
  listMyOrders,
  getMyOrder,
  updateOrderStatus,
  getOrderCounts,
  listPayments,
  getOrderInvoice,
} from "../controllers/vendorOrders.controller";
import { authenticateVendor } from "../middlewares/vendorAuth.middleware";

const router = Router();

router.use(authenticateVendor);

router.get("/", listMyOrders);
router.get("/payments", listPayments);
router.get("/summary/counts", getOrderCounts);
router.get("/:id/invoice", getOrderInvoice);
router.get("/:id", getMyOrder);
router.patch("/:id/status", updateOrderStatus);

export default router;
