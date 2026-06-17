import { Response, NextFunction, Request } from "express";
import mongoose from "mongoose";
import AppSettings from "../models/AppSettings.model";
import { AuthRequest } from "../types";

const DEFAULT_BULK_BANNER = {
  title: "Save Up to ₹15000 on Bulk Orders",
  subtitle: "Buy More, Save More on Your Projects",
  buttonText: "Get Bulk Quote",
};

// Ensures the singleton document exists and returns it.
const getOrCreateSettings = async () => {
  let settings = await AppSettings.findOne({ key: "default" });
  if (!settings) {
    settings = await AppSettings.create({ key: "default" });
  }
  return settings;
};

// ===== Public (customer app) — read-only, no auth =====
export const getPublicAppSettings = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const settings = await AppSettings.findOne({ key: "default" });
    res.json({
      success: true,
      data: {
        bulkBanner: {
          title: settings?.bulkBanner?.title || DEFAULT_BULK_BANNER.title,
          subtitle:
            settings?.bulkBanner?.subtitle || DEFAULT_BULK_BANNER.subtitle,
          buttonText:
            settings?.bulkBanner?.buttonText || DEFAULT_BULK_BANNER.buttonText,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ===== Admin — read =====
export const getAppSettings = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ===== Admin — update =====
export const updateAppSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { bulkBanner } = req.body;

    const settings = await getOrCreateSettings();

    if (bulkBanner) {
      settings.bulkBanner = {
        title:
          bulkBanner.title !== undefined
            ? String(bulkBanner.title).trim()
            : settings.bulkBanner?.title,
        subtitle:
          bulkBanner.subtitle !== undefined
            ? String(bulkBanner.subtitle).trim()
            : settings.bulkBanner?.subtitle,
        buttonText:
          bulkBanner.buttonText !== undefined
            ? String(bulkBanner.buttonText).trim()
            : settings.bulkBanner?.buttonText,
      };
      settings.markModified("bulkBanner");
    }

    if (req.admin?._id) {
      settings.updatedBy = new mongoose.Types.ObjectId(req.admin._id);
    }

    await settings.save();

    res.json({
      success: true,
      message: "App settings updated successfully.",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};
