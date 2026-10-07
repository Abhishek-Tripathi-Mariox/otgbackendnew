import { Request, Response, NextFunction } from "express";
import Category from "../models/Category.model";
import Brand from "../models/Brand.model";
import SubCategory from "../models/SubCategory.model";
import Material from "../models/Material.model";
import Banner from "../models/Banner.model";
import Vendor from "../models/Vendor.model";
import VendorMaterial from "../models/VendorMaterial.model";
import { searchAddress } from "../services/mapsService";
import { AppError } from "../middlewares/errorHandler";

// Distance-tier delivery estimate (F28-34) — no real logistics/ETA engine
// exists, so this is a simple, honest heuristic pending real routing data.
const DELIVERY_TIER_NEAR_KM = 10;
const DELIVERY_TIER_FAR_KM = 25;
const deliveryEstimateForDistance = (
  km: number | null,
  samePincode = false,
): string | null => {
  // A vendor whose own business pincode IS the delivery pincode is local by
  // definition, so they get the fast tier even when geocoding gave us no
  // distance — otherwise the exact-pincode fallback path showed no ETA for
  // anyone, which is the case customers hit most often.
  if (km == null) {
    return samePincode
      ? "Delivers within 2 hours"
      : "Delivery time confirmed on order";
  }
  if (km <= DELIVERY_TIER_NEAR_KM) return "Delivers within 2 hours";
  if (km <= DELIVERY_TIER_FAR_KM) return "Delivers within 4 hours";
  // Beyond the 4-hour tier we genuinely cannot promise an hour count, but
  // every option still needs to show a delivery line — so say the honest
  // thing rather than leaving the field blank.
  return "Delivery time confirmed on order";
};

// GET /api/mobile/categories - Get all active categories
export const getCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const categories = await Category.find({
      isDeleted: false,
      status: "active",
    })
      .select("name image order")
      .sort({ order: 1, name: 1 });

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/catalog/brands - Get all active brands
export const getBrands = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const brands = await Brand.find({
      isDeleted: false,
      status: "active",
    })
      .select("name image")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: brands,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/categories/:id/subcategories - Get subcategories for a category
export const getSubCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const subCategories = await SubCategory.find({
      category: id,
      isDeleted: false,
      status: "active",
    })
      .select("name image category")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: subCategories,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/materials - Get materials (with filters)
export const getMaterials = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      subCategory,
      brand,
      search,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {
      isDeleted: false,
      status: "active",
    };

    if (category) {
      query.category = category;
    }

    if (subCategory) {
      query.subCategory = subCategory;
    }

    if (brand) {
      // Material.brand is stored as the brand name string. Match exactly
      // (case-insensitive) so "Shop by brand" lists only that brand's items.
      query.brand = {
        $regex: `^${String(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      };
    }

    if (search) {
      const searchRegex = { $regex: search as string, $options: "i" };

      // Category/subCategory are ObjectId refs, so a regex can't match their
      // names directly — resolve matching ids first and fold them into the $or.
      const [matchedCategories, matchedSubCategories] = await Promise.all([
        Category.find({
          name: searchRegex,
          isDeleted: false,
          status: "active",
        }).select("_id"),
        SubCategory.find({
          name: searchRegex,
          isDeleted: false,
          status: "active",
        }).select("_id"),
      ]);

      query.$or = [
        { name: searchRegex },
        { brand: searchRegex },
        { description: searchRegex },
        { category: { $in: matchedCategories.map((c) => c._id) } },
        { subCategory: { $in: matchedSubCategories.map((s) => s._id) } },
      ];
    }

    const [materials, total] = await Promise.all([
      Material.find(query)
        .select(
          "name images brand category subCategory unit minOrderQty mrp sellingPrice finalSellingPrice gst requestQuote transportation",
        )
        .populate("category", "name")
        .populate("subCategory", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Material.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: materials,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/materials/:id - Get single material detail
export const getMaterialDetail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const material = await Material.findOne({
      _id: id,
      isDeleted: false,
      status: "active",
    })
      .populate("category", "name")
      .populate("subCategory", "name");

    if (!material) {
      res.status(404).json({
        success: false,
        message: "Material not found",
      });
      return;
    }

    res.json({
      success: true,
      data: material,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/catalog/banners - Get active banners
export const getBanners = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const banners = await Banner.find({
      isDeleted: false,
      status: "active",
    })
      .select("title image link order enableBulkQuote")
      .sort({ order: 1 });

    res.json({
      success: true,
      data: banners,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/mobile/catalog/materials/:id/vendors?pincode=XXXXXX
// Region/pincode-based vendor search (F28-34): every approved vendor
// stocking this material, with that vendor's own price and a delivery-time
// estimate, sorted nearest-first — but NOT filtered to a radius, so a
// farther, cheaper vendor still shows up for the customer to compare and
// deliberately choose (F32-34).
export const getMaterialVendors = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const pincode = String(req.query.pincode || "").trim();
    const pinMatch = pincode.match(/\d{6}/);
    if (!pinMatch) {
      throw new AppError("A valid 6-digit pincode is required.", 400);
    }
    const pin = pinMatch[0];

    const stocking = await VendorMaterial.find({
      material: id,
      isAvailable: true,
      verificationStatus: "approved",
    })
      // NOTE: `price` here is the Vendor -> OTG cost rate and must NEVER be
      // returned to a customer. The customer-facing number is
      // `customerPrice`, falling back to the master catalog price below.
      .select("vendor price customerPrice minOrderQty maxOrderQty")
      .lean();

    if (stocking.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Master-catalog selling price, used whenever a vendor has no explicit
    // OTG -> Customer rate of their own (which is every pre-existing row).
    const material = await Material.findById(id)
      .select("finalSellingPrice sellingPrice")
      .lean();
    const catalogPrice =
      (material as any)?.finalSellingPrice ??
      (material as any)?.sellingPrice ??
      null;

    const vendorIds = stocking.map((s) => s.vendor);
    const rateByVendor = new Map(stocking.map((s) => [String(s.vendor), s]));

    // Try to geocode the pincode to real coordinates so distance/delivery
    // tiers can be computed; if that fails (no API key configured, network
    // issue, unrecognized pincode), fall back to exact business-pincode
    // string matching — same convention as vendorNotify.ts/driverNotify.ts —
    // with no distance/estimate shown for anyone outside that exact match.
    let coords: [number, number] | null = null;
    try {
      const results = await searchAddress(`${pin}, India`);
      const first = results.find((r) => r.lat && r.lon);
      if (first) coords = [Number(first.lon), Number(first.lat)];
    } catch {
      // fall through to pincode-string fallback below
    }

    let vendors: Array<{_id: any; name?: string; business?: any; distanceMeters?: number}>;
    if (coords) {
      vendors = await Vendor.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: coords },
            distanceField: "distanceMeters",
            spherical: true,
            query: {
              _id: { $in: vendorIds },
              status: "active",
              approvalStatus: "approved",
              isDeleted: false,
            },
          },
        },
        { $project: { name: 1, business: 1, distanceMeters: 1 } },
      ]);
    } else {
      vendors = await Vendor.find({
        _id: { $in: vendorIds },
        status: "active",
        approvalStatus: "approved",
        isDeleted: false,
        "business.pincode": new RegExp(pin),
      })
        .select("name business")
        .lean();
    }

    const results = vendors
      .map((v: any) => {
        const rate = rateByVendor.get(String(v._id));
        const distanceKm =
          v.distanceMeters != null ? +(v.distanceMeters / 1000).toFixed(1) : null;
        // Vendors whose own business pincode matches the delivery pincode
        // rank above everyone else — the $geoNear branch queries by distance
        // only and otherwise happily returns a nationwide list.
        const samePincode = String(v.business?.pincode || "").includes(pin);
        return {
          vendorId: v._id,
          vendorName: v.business?.name || v.name || "Vendor",
          // Customer-facing price only. `rate.price` (Vendor -> OTG) is
          // deliberately NOT exposed here — it is OTG's cost and margin.
          price: rate?.customerPrice ?? catalogPrice,
          minOrderQty: rate?.minOrderQty ?? 1,
          maxOrderQty: rate?.maxOrderQty ?? null,
          distanceKm,
          samePincode,
          deliveryEstimate: deliveryEstimateForDistance(distanceKm, samePincode),
        };
      })
      .filter((r) => r.price != null)
      .sort((a, b) => {
        // 1) same-pincode vendors first
        if (a.samePincode !== b.samePincode) return a.samePincode ? -1 : 1;
        // 2) then nearest first (vendors with a known distance outrank ones
        //    whose location has never been pinned)
        if (a.distanceKm != null && b.distanceKm != null) {
          if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        } else if (a.distanceKm != null) return -1;
        else if (b.distanceKm != null) return 1;
        // 3) finally cheapest first
        return (a.price ?? 0) - (b.price ?? 0);
      });

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};
