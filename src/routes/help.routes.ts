import { Router } from "express";
import {
  getPublicHelpSettings,
  getAdminHelpSettings,
  upsertHelpSettings,
  createSupportTicket,
  listMySupportTickets,
  listSupportTickets,
  supportTicketCounts,
  replyToSupportTicket,
  updateSupportTicketStatus,
  deleteSupportTicket,
} from "../controllers/help.controller";
import { authenticate } from "../middlewares/auth.middleware";
import {
  authenticateUser,
  optionalAuthenticateUser,
} from "../middlewares/userAuth.middleware";

const router = Router();

// ===== Public (customer app) =====
router.get("/public/settings", getPublicHelpSettings);
router.post("/public/tickets", optionalAuthenticateUser, createSupportTicket);

// Logged-in customer
router.get("/me/tickets", authenticateUser, listMySupportTickets);

// ===== Admin =====
router.get("/settings", authenticate, getAdminHelpSettings);
router.put("/settings", authenticate, upsertHelpSettings);
router.get("/tickets", authenticate, listSupportTickets);
router.get("/tickets/counts", authenticate, supportTicketCounts);
router.patch("/tickets/:id/reply", authenticate, replyToSupportTicket);
router.patch("/tickets/:id/status", authenticate, updateSupportTicketStatus);
router.delete("/tickets/:id", authenticate, deleteSupportTicket);

export default router;
