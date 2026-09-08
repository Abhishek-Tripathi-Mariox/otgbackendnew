import { Response, NextFunction } from "express";
import Config from "../models/Config.model";
import { AuthRequest } from "../types";
import { generateOtp, sendOtpSms } from "../services/otpService";
import { AppError } from "../middlewares/errorHandler";

// Default field definitions for each service
const SERVICE_DEFAULTS: Record<
  string,
  { label: string; fields: { key: string; label: string }[] }
> = {
  "google-api": {
    label: "Google API",
    fields: [
      { key: "apiKey", label: "API Key" },
      { key: "mapsApiKey", label: "Maps API Key" },
      { key: "placesApiKey", label: "Places API Key" },
    ],
  },
  firebase: {
    label: "Firebase",
    fields: [
      { key: "projectId", label: "Project ID" },
      { key: "apiKey", label: "API Key" },
      { key: "authDomain", label: "Auth Domain" },
      { key: "storageBucket", label: "Storage Bucket" },
      { key: "messagingSenderId", label: "Messaging Sender ID" },
      { key: "appId", label: "App ID" },
      // Modern FCM HTTP v1 API needs the full service-account JSON, not a
      // legacy server key — Google has deprecated the legacy
      // fcm.googleapis.com/fcm/send endpoint for new Firebase projects.
      { key: "serviceAccountJson", label: "Service Account JSON (for push notifications)" },
    ],
  },
  razorpay: {
    label: "Razorpay",
    fields: [
      { key: "keyId", label: "Key ID" },
      { key: "keySecret", label: "Key Secret" },
      { key: "webhookSecret", label: "Webhook Secret" },
    ],
  },
  sms: {
    label: "SMS",
    fields: [
      { key: "provider", label: "Provider" },
      { key: "apiKey", label: "Auth Key" },
      { key: "senderId", label: "Sender ID" },
      { key: "templateId", label: "OTP Template ID" },
    ],
  },
};

// Only MSG91 is actually implemented as a send path (see otpService.ts) —
// exposed so the admin UI can render this as a constrained dropdown instead
// of a free-text field the admin could mistype.
export const SMS_PROVIDERS = ["MSG91"];

// Ephemeral store for the admin's "send a real test OTP to this number"
// flow — deliberately NOT persisted to Mongo, since it's just a delivery
// smoke-test, not a real login. Auto-expires after 5 minutes.
const TEST_OTP_TTL_MS = 5 * 60 * 1000;
const testOtpStore = new Map<string, { otp: string; expiresAt: number }>();

const cleanupExpiredTestOtps = () => {
  const now = Date.now();
  for (const [mobile, entry] of testOtpStore) {
    if (entry.expiresAt < now) testOtpStore.delete(mobile);
  }
};

// GET /api/config - List all configs (masked values)
export const getAllConfigs = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const services = Object.keys(SERVICE_DEFAULTS);

    // Ensure all service configs exist in DB
    for (const service of services) {
      const exists = await Config.findOne({ service });
      if (!exists) {
        await Config.create({
          service,
          label: SERVICE_DEFAULTS[service].label,
          fields: SERVICE_DEFAULTS[service].fields.map((f) => ({
            key: f.key,
            label: f.label,
            value: "",
          })),
          isActive: false,
        });
      }
    }

    const configs = await Config.find({}).sort({ service: 1 });

    const masked = configs.map((config) => ({
      _id: config._id,
      service: config.service,
      label: config.label,
      isActive: config.isActive,
      fields: (config as any).getMaskedFields(),
      updatedBy: config.updatedBy,
      updatedAt: config.updatedAt,
    }));

    res.json({ success: true, data: masked });
  } catch (error) {
    next(error);
  }
};

// GET /api/config/:service - Get single config (decrypted for editing)
export const getConfig = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { service } = req.params;

    if (!SERVICE_DEFAULTS[service]) {
      res.status(400).json({ success: false, message: "Invalid service" });
      return;
    }

    let config = await Config.findOne({ service }).populate(
      "updatedBy",
      "name email",
    );

    if (!config) {
      config = await Config.create({
        service,
        label: SERVICE_DEFAULTS[service].label,
        fields: SERVICE_DEFAULTS[service].fields.map((f) => ({
          key: f.key,
          label: f.label,
          value: "",
        })),
        isActive: false,
      });
    }

    res.json({
      success: true,
      data: {
        _id: config._id,
        service: config.service,
        label: config.label,
        isActive: config.isActive,
        fields: (config as any).getDecryptedFields(),
        updatedBy: config.updatedBy,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/config/:service - Update config
export const updateConfig = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { service } = req.params;
    const { fields, isActive } = req.body;

    if (!SERVICE_DEFAULTS[service]) {
      res.status(400).json({ success: false, message: "Invalid service" });
      return;
    }

    let config = await Config.findOne({ service });

    if (!config) {
      config = new Config({
        service,
        label: SERVICE_DEFAULTS[service].label,
        fields: [],
        isActive: false,
      });
    }

    // Update fields - merge with defaults to retain structure
    if (fields && Array.isArray(fields)) {
      const defaultFields = SERVICE_DEFAULTS[service].fields;
      config.fields = defaultFields.map((df) => {
        const incoming = fields.find((f: any) => f.key === df.key);
        return {
          key: df.key,
          label: df.label,
          value: incoming ? incoming.value : "",
        };
      });
    }

    if (typeof isActive === "boolean") {
      config.isActive = isActive;
    }

    config.updatedBy = req.admin
      ? (req.admin._id as any)
      : null;

    await config.save();

    res.json({
      success: true,
      message: `${SERVICE_DEFAULTS[service].label} configuration updated successfully`,
      data: {
        _id: config._id,
        service: config.service,
        label: config.label,
        isActive: config.isActive,
        fields: (config as any).getMaskedFields(),
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/config/:service/toggle - Toggle active status
export const toggleConfigStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { service } = req.params;

    const config = await Config.findOne({ service });
    if (!config) {
      res.status(404).json({ success: false, message: "Config not found" });
      return;
    }

    config.isActive = !config.isActive;
    config.updatedBy = req.admin
      ? (req.admin._id as any)
      : null;
    await config.save();

    res.json({
      success: true,
      message: `${config.label} ${config.isActive ? "enabled" : "disabled"} successfully`,
      data: { service: config.service, isActive: config.isActive },
    });
  } catch (error) {
    next(error);
  }
};

const MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * POST /api/config/sms/test/send
 * Sends a REAL OTP to the given mobile number using the currently SAVED SMS
 * config (not unsaved form edits — save first, then test, so this always
 * proves exactly what production will use). Never reveals the OTP in the
 * response; the admin must actually receive the SMS to test delivery.
 */
export const sendTestOtp = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile } = req.body as { mobile?: string };
    if (!mobile || !MOBILE_REGEX.test(mobile)) {
      throw new AppError("Enter a valid 10-digit mobile number.", 400);
    }

    cleanupExpiredTestOtps();

    const otp = generateOtp();
    const sent = await sendOtpSms(mobile, otp);

    if (!sent) {
      throw new AppError(
        "Could not send test OTP — check that the SMS configuration is saved and enabled, and that the credentials are correct.",
        400,
      );
    }

    testOtpStore.set(mobile, { otp, expiresAt: Date.now() + TEST_OTP_TTL_MS });

    res.json({
      success: true,
      message: `Test OTP sent to ${mobile}. Enter the code you received to verify.`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/config/sms/test/verify
 * Confirms the OTP the admin actually received matches what was sent —
 * proves both send AND delivery worked, not just that the API call succeeded.
 */
export const verifyTestOtp = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile, otp } = req.body as { mobile?: string; otp?: string };
    if (!mobile || !otp) {
      throw new AppError("Mobile number and OTP are required.", 400);
    }

    cleanupExpiredTestOtps();

    const entry = testOtpStore.get(mobile);
    if (!entry) {
      throw new AppError(
        "No test OTP found for this number — it may have expired. Send a new test OTP.",
        400,
      );
    }

    if (entry.otp !== otp) {
      res.status(400).json({ success: false, message: "Incorrect OTP. Please try again." });
      return;
    }

    testOtpStore.delete(mobile);
    res.json({ success: true, message: "OTP verified — SMS delivery is working correctly." });
  } catch (error) {
    next(error);
  }
};
