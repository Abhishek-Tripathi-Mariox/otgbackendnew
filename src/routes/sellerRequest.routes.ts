import { Router } from "express";
import {
  createSellerRequest,
  getMySellerRequest,
  listSellerRequests,
  getSellerRequest,
  updateSellerRequest,
  approveSellerRequest,
  rejectSellerRequest,
  deleteSellerRequest,
  sellerRequestCounts,
} from "../controllers/sellerRequest.controller";
import { authenticate } from "../middlewares/auth.middleware";
import {
  authenticateUser,
  optionalAuthenticateUser,
} from "../middlewares/userAuth.middleware";

const router = Router();

// ===== Customer (mobile) routes =====
// Submit a request — auth is optional so guests can also apply, but if logged in
// we link the request to the user.
router.post("/", optionalAuthenticateUser, createSellerRequest);

// Logged-in customer can check their own request status to hide the button
router.get("/me", authenticateUser, getMySellerRequest);

// ===== Admin routes =====
router.get("/", authenticate, listSellerRequests);
router.get("/counts", authenticate, sellerRequestCounts);
router.get("/:id", authenticate, getSellerRequest);
router.put("/:id", authenticate, updateSellerRequest);
router.patch("/:id/approve", authenticate, approveSellerRequest);
router.patch("/:id/reject", authenticate, rejectSellerRequest);
router.delete("/:id", authenticate, deleteSellerRequest);

export default router;
