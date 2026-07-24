import { Router } from "express";
import { getPaymentLogs, getPaymentLog } from "../controllers/payments.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/logs", getPaymentLogs);
router.get("/logs/:id", getPaymentLog);

export default router;
