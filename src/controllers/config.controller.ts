import { Response, NextFunction } from "express";
import Config from "../models/Config.model";
import { AuthRequest } from "../types";

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
      { key: "serverKey", label: "Server Key (FCM)" },
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
      { key: "provider", label: "Provider Name" },
      { key: "apiKey", label: "API Key" },
      { key: "apiSecret", label: "API Secret" },
      { key: "senderId", label: "Sender ID" },
      { key: "templateId", label: "Template ID" },
    ],
  },
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
