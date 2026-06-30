import { Router } from "express";
import {
  listMyOrders,
  getMyOrder,
  updateOrderStatus,
  getOrderCounts,
  listPayments,
  getOrderInvoice,
  submitQC,
  packOrder,
  dispatchOrder,
  getAssignableDrivers,
  uploadVendorImage,
} from "../controllers/vendorOrders.controller";
import { authenticateVendor } from "../middlewares/vendorAuth.middleware";

const router = Router();

router.use(authenticateVendor);

router.post("/upload", uploadVendorImage);
router.get("/", listMyOrders);
router.get("/payments", listPayments);
router.get("/summary/counts", getOrderCounts);
router.get("/assignable-drivers", getAssignableDrivers);
router.get("/:id/invoice", getOrderInvoice);
router.get("/:id", getMyOrder);
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/qc", submitQC);
router.patch("/:id/pack", packOrder);
router.patch("/:id/dispatch", dispatchOrder);

export default router;
