import { Router } from "express";
import {
  getDrivers,
  getDriver,
  updateDriver,
  deleteDriver,
  restoreDriver,
  permanentDeleteDriver,
  toggleDriverStatus,
  approveDriver,
  rejectDriver,
  approveDocument,
  rejectDocument,
  approveVehicleDocument,
  rejectVehicleDocument,
  getDriverStats,
} from "../controllers/driver.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/stats", getDriverStats);
router.get("/", getDrivers);
router.get("/:id", getDriver);
router.put("/:id", updateDriver);
router.delete("/:id", deleteDriver);
router.patch("/:id/restore", restoreDriver);
router.delete("/:id/permanent", permanentDeleteDriver);
router.patch("/:id/toggle-status", toggleDriverStatus);

router.patch("/:id/approve", approveDriver);
router.patch("/:id/reject", rejectDriver);

// Driver-owned doc (driving license)
router.patch("/:id/documents/:docType/approve", approveDocument);
router.patch("/:id/documents/:docType/reject", rejectDocument);

// Vehicle-owned docs (RC / insurance / pollution)
router.patch(
  "/:id/vehicles/:vehicleId/documents/:docType/approve",
  approveVehicleDocument,
);
router.patch(
  "/:id/vehicles/:vehicleId/documents/:docType/reject",
  rejectVehicleDocument,
);

export default router;
