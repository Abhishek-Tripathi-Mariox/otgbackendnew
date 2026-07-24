import { Request, Response, NextFunction } from "express";
import { AppError } from "../middlewares/errorHandler";
import { searchAddress, reverseGeocode } from "../services/mapsService";

/**
 * GET /api/geocode/search?q=...
 * Shared, unauthenticated address-search proxy for all 4 client apps —
 * uses Google Places if the admin has configured it, else free OSM
 * Nominatim (identical to what each app previously called directly).
 */
export const search = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) throw new AppError("Query parameter 'q' is required.", 400);

    const results = await searchAddress(q);
    res.json(results);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/geocode/reverse?lat=&lon=
 */
export const reverse = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new AppError("Query parameters 'lat' and 'lon' are required.", 400);
    }

    const result = await reverseGeocode(lat, lon);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
