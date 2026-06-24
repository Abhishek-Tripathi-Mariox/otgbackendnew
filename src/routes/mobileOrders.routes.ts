import { Router } from "express";
import {
  listMyOrders,
  getMyOrder,
  createOrderFromCart,
  getOrderTracking,
  getOrderInvoiceHtml,
} from "../controllers/mobileOrders.controller";
import { authenticateUser } from "../middlewares/userAuth.middleware";

const router = Router();

// Invoice is authenticated via a `token` query param (handled inside the
// controller) so it can be opened directly in the device browser for PDF/print.
// Must be registered BEFORE the global authenticateUser middleware.
router.get("/:id/invoice", getOrderInvoiceHtml);

router.use(authenticateUser);

router.get("/", listMyOrders);
router.get("/:id/tracking", getOrderTracking);
router.get("/:id", getMyOrder);
router.post("/", createOrderFromCart);

export default router;
