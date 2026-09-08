import { Router } from "express";
import {
  getNotifications,
  getNotification,
  sendNotification,
  deleteNotification,
  searchRecipients,
} from "../controllers/notification.controller";
import {
  listAdminNotifications,
  getAdminUnreadCount,
  markAllAdminNotificationsRead,
  markAdminNotificationRead,
} from "../controllers/adminNotifications.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

// Admin's own notification bell/dropdown (inbox) — distinct from the routes
// below, which are the admin's OUTBOUND broadcast composer to users/vendors/
// drivers. Registered first so "/inbox" isn't swallowed by "/:id".
router.get("/inbox", listAdminNotifications);
router.get("/inbox/unread-count", getAdminUnreadCount);
router.patch("/inbox/read-all", markAllAdminNotificationsRead);
router.patch("/inbox/:id/read", markAdminNotificationRead);

router.get("/", getNotifications);
router.get("/recipients/search", searchRecipients);
router.get("/:id", getNotification);
router.post("/send", sendNotification);
router.delete("/:id", deleteNotification);

export default router;
