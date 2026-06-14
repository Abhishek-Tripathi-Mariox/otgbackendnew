import { Router } from "express";
import {
  getNotifications,
  getNotification,
  sendNotification,
  deleteNotification,
  searchRecipients,
} from "../controllers/notification.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getNotifications);
router.get("/recipients/search", searchRecipients);
router.get("/:id", getNotification);
router.post("/send", sendNotification);
router.delete("/:id", deleteNotification);

export default router;
