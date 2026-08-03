import { Router } from "express";
import { getInvoiceHtml } from "../controllers/invoice.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/:id/html", getInvoiceHtml);

export default router;
