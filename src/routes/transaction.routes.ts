import { Router } from "express";
import {
  listTransactions,
  transactionStats,
  getTransaction,
  createTransaction,
  updateTransactionStatus,
  deleteTransaction,
} from "../controllers/transaction.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.get("/", authenticate, listTransactions);
router.get("/stats", authenticate, transactionStats);
router.get("/:id", authenticate, getTransaction);
router.post("/", authenticate, createTransaction);
router.patch("/:id/status", authenticate, updateTransactionStatus);
router.delete("/:id", authenticate, deleteTransaction);

export default router;
