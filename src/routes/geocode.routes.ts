import { Router } from "express";
import rateLimit from "express-rate-limit";
import { search, reverse } from "../controllers/geocode.controller";

const router = Router();

// Unauthenticated: shared across the customer, driver, vendor apps and
// OTG-Admin. The data returned (address lookups) isn't sensitive, so no auth
// is required — but unauthenticated + can proxy to a paid Google API key
// means it also needs a rate limit, or anyone could script requests against
// it and run up the admin's Google billing (or get Nominatim's shared
// User-Agent blocked for all 4 apps).
const geocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many location requests. Please slow down." },
});

router.use(geocodeLimiter);

router.get("/search", search);
router.get("/reverse", reverse);

export default router;
