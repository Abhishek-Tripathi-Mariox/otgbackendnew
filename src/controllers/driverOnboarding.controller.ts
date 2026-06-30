import { Response, NextFunction } from "express";
import Driver, {
  OnboardingStep,
  advanceStep,
} from "../models/Driver.model";
import { AppError } from "../middlewares/errorHandler";
import { DriverRequest } from "../middlewares/driverAuth.middleware";
import { uploadBufferToS3 } from "../config/s3";

// Documents the driver can upload: KYC images or PDF scans. Kept in sync with
// the mobile picker, which accepts photos (camera/gallery) and files (PDF).
const ALLOWED_DOC_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
];

// base64 of a 7 MB file is ~9.4 MB, which stays under the 10 MB express.json cap.
const MAX_DOC_BYTES = 7 * 1024 * 1024;

const respond = (driver: any) => ({
  success: true,
  data: {
    onboardingStep: driver.onboardingStep,
    approvalStatus: driver.approvalStatus,
    driver,
  },
});

const loadDriver = async (req: DriverRequest) => {
  const driver = await Driver.findById(req.driver!.id);
  if (!driver) throw new AppError("Driver not found", 404);
  if (driver.isDeleted) throw new AppError("Account has been deleted", 401);
  return driver;
};

const VALID_VEHICLE_TYPES = ["3", "4", "6", "8", "10", "12", "16"];
const INDIAN_REG_REGEX = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/;

// Accepts YYYY-MM-DD or anything Date can parse to a real, finite date.
// Rejects "garbage", "13/45/9999", empty strings (caller decides whether to allow undefined).
const parseDate = (value: unknown, label: string): Date => {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(`${label} is not a valid date. Please use YYYY-MM-DD.`, 400);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new AppError(`${label} is not a valid date. Please use YYYY-MM-DD.`, 400);
  }
  return d;
};

const VEHICLE_DOC_KEYS = ["rcBook", "insurance", "pollutionCertificate"] as const;
type VehicleDocKey = (typeof VEHICLE_DOC_KEYS)[number];

// Take a `documents: { rcBook?: url, insurance?: url, pollutionCertificate?: url }`
// shape from the body and convert to the embedded subdoc shape.
// Re-uploads after rejection reset to "pending"; previously-approved docs stay approved.
const buildVehicleDocs = (
  incoming: any,
  existing: any,
): Record<string, any> | undefined => {
  if (!incoming || typeof incoming !== "object") return undefined;
  const out: Record<string, any> = { ...(existing || {}) };
  for (const key of VEHICLE_DOC_KEYS) {
    const value = incoming[key];
    if (typeof value !== "string" || !value) continue;
    const prev = existing?.[key];
    out[key] = {
      url: value,
      status: prev?.status === "approved" ? "approved" : "pending",
      rejectionReason: undefined,
      uploadedAt: new Date(),
    };
  }
  return out;
};

const validateVehiclePayload = (payload: any) => {
  if (payload.type && !VALID_VEHICLE_TYPES.includes(String(payload.type))) {
    throw new AppError(
      `Invalid vehicle type. Must be one of: ${VALID_VEHICLE_TYPES.join(", ")} wheeler.`,
      400,
    );
  }

  if (payload.registrationNo) {
    const normalized = String(payload.registrationNo)
      .toUpperCase()
      .replace(/[\s-]/g, "");
    if (!INDIAN_REG_REGEX.test(normalized)) {
      throw new AppError(
        "Invalid registration number. Expected Indian format (e.g. KA01AB1234).",
        400,
      );
    }
    payload.registrationNo = normalized;
  }

  if (payload.insuranceExpiry !== undefined && payload.insuranceExpiry !== "") {
    payload.insuranceExpiry = parseDate(
      payload.insuranceExpiry,
      "Insurance expiry date",
    );
  } else {
    delete payload.insuranceExpiry;
  }

  if (payload.year !== undefined && payload.year !== "") {
    const y = String(payload.year);
    if (!/^\d{4}$/.test(y)) {
      throw new AppError("Year must be a 4-digit number.", 400);
    }
    const yi = parseInt(y, 10);
    const currentYear = new Date().getFullYear();
    if (yi < 1980 || yi > currentYear + 1) {
      throw new AppError(
        `Year must be between 1980 and ${currentYear + 1}.`,
        400,
      );
    }
    payload.year = y;
  }

  return payload;
};

export { parseDate };

// Add a vehicle to the driver. First call also advances onboardingStep -> owner.
export const addVehicle = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const payload = validateVehiclePayload({ ...req.body });
    const incomingDocs = payload.documents;
    delete payload.documents;

    const driver = await loadDriver(req);

    // Reject duplicate registration numbers on the same driver.
    if (
      payload.registrationNo &&
      driver.vehicles.some((v) => v.registrationNo === payload.registrationNo)
    ) {
      throw new AppError(
        "A vehicle with this registration number already exists.",
        409,
      );
    }

    const docs = buildVehicleDocs(incomingDocs, undefined);
    driver.vehicles.push({ ...payload, ...(docs ? { documents: docs } : {}) });
    if (driver.onboardingStep === "vehicle") {
      driver.onboardingStep = advanceStep(driver.onboardingStep, "vehicle");
    }
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

// Update a single vehicle by its embedded _id.
export const updateVehicle = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vehicleId } = req.params;
    const payload = validateVehiclePayload({ ...req.body });

    const incomingDocs = payload.documents;
    delete payload.documents;

    const driver = await loadDriver(req);
    const vehicle = (driver.vehicles as any).id(vehicleId);
    if (!vehicle) throw new AppError("Vehicle not found", 404);

    if (
      payload.registrationNo &&
      driver.vehicles.some(
        (v) =>
          v.registrationNo === payload.registrationNo &&
          v._id?.toString() !== vehicleId,
      )
    ) {
      throw new AppError(
        "Another vehicle with this registration number already exists.",
        409,
      );
    }

    Object.assign(vehicle, payload);
    const merged = buildVehicleDocs(incomingDocs, vehicle.documents);
    if (merged) vehicle.documents = merged;
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

export const deleteVehicle = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vehicleId } = req.params;
    const driver = await loadDriver(req);
    const vehicle = (driver.vehicles as any).id(vehicleId);
    if (!vehicle) throw new AppError("Vehicle not found", 404);

    // A driver must keep at least one vehicle.
    if (driver.vehicles.length <= 1) {
      throw new AppError(
        "You must have at least one registered vehicle.",
        400,
      );
    }

    vehicle.deleteOne();
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

export const saveOwner = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driver = await loadDriver(req);
    driver.owner = { ...(driver.owner || {}), ...req.body };
    driver.onboardingStep = advanceStep(driver.onboardingStep, "owner");
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

export const savePersonal = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, dateOfBirth, address, pincode } = req.body;
    const driver = await loadDriver(req);

    if (name !== undefined) driver.name = name;
    if (email !== undefined) {
      const trimmed = String(email).trim();
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        throw new AppError("Please enter a valid email address.", 400);
      }
      driver.email = trimmed || undefined;
    }
    if (dateOfBirth !== undefined) {
      driver.dateOfBirth = dateOfBirth
        ? parseDate(dateOfBirth, "Date of birth")
        : undefined;
    }

    // Pincode is used to match the driver to vendors in the same area
    // (a vendor only sees drivers whose pincode matches theirs).
    if (pincode !== undefined) {
      if (!driver.address) driver.address = {};
      driver.address.pincode = String(pincode).trim() || undefined;
    }

    if (address !== undefined) {
      // address can be a string (the app sends a single full-address field) or an
      // object. We mutate sub-fields rather than reassigning the whole address —
      // reassigning surfaces `location: undefined` from the existing subdocument,
      // which fails to cast against the GeoJSON Point schema.
      if (!driver.address) driver.address = {};
      if (typeof address === "string") {
        driver.address.full = address;
      } else if (address && typeof address === "object") {
        const { location, ...rest } = address as Record<string, any>;
        Object.assign(driver.address, rest);
        // Only set location when valid coordinates are provided; never undefined.
        if (
          location &&
          Array.isArray(location.coordinates) &&
          location.coordinates.length === 2
        ) {
          driver.address.location = {
            type: "Point",
            coordinates: location.coordinates,
          };
        }
      }
    }

    driver.onboardingStep = advanceStep(driver.onboardingStep, "personal");
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

// Generic document upload. The mobile app sends a base64 data URI (same proven
// path as the profile image — RN multipart is unreliable on Android), we push it
// to S3 and return the public URL. The caller then stores that URL via the
// relevant save endpoint (driving license, vehicle docs, bank passbook).
export const uploadDriverDocument = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { file } = req.body as { file?: string };
    if (!file || typeof file !== "string" || !file.startsWith("data:")) {
      throw new AppError("file (base64 data URI) is required", 400);
    }

    const match = file.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
    if (!match) throw new AppError("Invalid base64 file payload", 400);

    const mime = match[1];
    const payload = match[2];
    if (!ALLOWED_DOC_MIME.includes(mime)) {
      throw new AppError(
        "Only JPG, PNG, WebP images or PDF files are allowed.",
        400,
      );
    }

    const buffer = Buffer.from(payload, "base64");
    if (buffer.length === 0) throw new AppError("Empty file payload", 400);
    if (buffer.length > MAX_DOC_BYTES) {
      throw new AppError("File must be 7 MB or smaller.", 400);
    }

    const url = await uploadBufferToS3(buffer, "driver/documents", mime);
    res.json({ success: true, data: { url } });
  } catch (error) {
    next(error);
  }
};

// Save driving license (driver-owned document — uploaded during the personal step).
// Vehicle-owned documents (RC, insurance, pollution) live on each vehicle and are
// saved via the vehicle add/update endpoints.
export const saveDrivingLicense = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      throw new AppError("url is required", 400);
    }
    const driver = await loadDriver(req);
    const existing = driver.documents?.drivingLicense;
    driver.documents.drivingLicense = {
      url,
      status: existing?.status === "approved" ? "approved" : "pending",
      rejectionReason: undefined,
      uploadedAt: new Date(),
    };
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

export const saveBank = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driver = await loadDriver(req);
    driver.bank = { ...(driver.bank || {}), ...req.body };
    driver.onboardingStep = advanceStep(driver.onboardingStep, "bank");
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

// Re-upload the driver's driving license after admin rejects.
export const reuploadDrivingLicense = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { url } = req.body;
    if (!url) throw new AppError("url is required", 400);

    const driver = await loadDriver(req);
    driver.documents.drivingLicense = {
      url,
      status: "pending",
      rejectionReason: undefined,
      uploadedAt: new Date(),
    };
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};

// Re-upload an RC/insurance/pollution document for a specific vehicle.
export const reuploadVehicleDocument = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { vehicleId, docType } = req.params;
    const { url } = req.body;
    if (!url) throw new AppError("url is required", 400);
    if (!VEHICLE_DOC_KEYS.includes(docType as VehicleDocKey)) {
      throw new AppError(
        `Invalid document type. Allowed: ${VEHICLE_DOC_KEYS.join(", ")}`,
        400,
      );
    }

    const driver = await loadDriver(req);
    const vehicle = (driver.vehicles as any).id(vehicleId);
    if (!vehicle) throw new AppError("Vehicle not found", 404);

    if (!vehicle.documents) vehicle.documents = {};
    vehicle.documents[docType] = {
      url,
      status: "pending",
      rejectionReason: undefined,
      uploadedAt: new Date(),
    };
    await driver.save();
    res.json(respond(driver));
  } catch (error) {
    next(error);
  }
};
