import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";
import Category from "../models/Category.model";
import Brand from "../models/Brand.model";
import SubCategory from "../models/SubCategory.model";
import Material from "../models/Material.model";
import Banner from "../models/Banner.model";
import Vendor from "../models/Vendor.model";
import VendorMaterial, {
  CUSTOMER_VISIBLE_VERIFICATION,
} from "../models/VendorMaterial.model";
import { searchAddress } from "../services/mapsService";
import { AppError } from "../middlewares/errorHandler";

// Distance-tier delivery estimate (F28-34) — no real logistics/ETA engine
// exists, so this is a simple, honest heuristic pending real routing data.
const DELIVERY_TIER_NEAR_KM = 10;
const DELIVERY_TIER_FAR_KM = 25;
/**
 * Numeric companion to deliveryEstimateForDistance, so the list can actually
 * be SORTED by delivery speed. The label alone is a string, which cannot be
 * ordered meaningfully. `null` means "no committed ETA" and always sorts
 * last.
 */
const deliveryEtaHoursForDistance = (
  km: number | null,
  samePincode = false,
): number | null => {
  if (km == null) return samePincode ? 2 : null;
  if (km <= DELIVERY_TIER_NEAR_KM) return 2;
  if (km <= DELIVERY_TIER_FAR_KM) return 4;
  return null;
};

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

// Customer-facing vendor identity.
//
// A vendor's trading NAME is deliberately never sent to the customer app:
// knowing it lets a buyer contact the supplier directly and cut OTG out of
// the deal it sourced. The vendor CODE identifies the supplier well enough
// for the customer to compare options, re-select the same one, and quote it
// to support, without revealing who they are. Enforced here at the API
// rather than only in the UI, so the name cannot leak through the wire.
const customerFacingVendorLabel = (vendor: any): string =>
  vendor?.vendorCode || "Supplier";

/**
 * Resolve the vendors that can serve a delivery pincode, with their distance
 * where known.
 *
 * Shared by the material list's supplier summary and the per-material vendor
 * comparison so both answer "who can supply me here?" the same way. Geocodes
 * the pincode to rank by real distance; when that is unavailable (no API key,
 * network failure, unrecognised pincode) it degrades to matching the vendor's
 * own business pincode, which is the common case anyway.
 */
const resolveVendorsForPincode = async (
  pin: string,
  vendorIds: any[],
): Promise<
  Array<{
    _id: any;
    name?: string;
    vendorCode?: string;
    business?: any;
    distanceMeters?: number;
  }>
> => {
  if (vendorIds.length === 0) return [];

  let coords: [number, number] | null = null;
  try {
    const results = await searchAddress(`${pin}, India`);
    const first = results.find((r) => r.lat && r.lon);
    if (first) coords = [Number(first.lon), Number(first.lat)];
  } catch {
    // fall through to the pincode-string match below
  }

  const baseQuery = {
    _id: { $in: vendorIds },
    status: "active",
    approvalStatus: "approved",
    isDeleted: false,
  };

  if (coords) {
    return Vendor.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: coords },
          distanceField: "distanceMeters",
          spherical: true,
          query: baseQuery,
        },
      },
      { $project: { name: 1, vendorCode: 1, business: 1, distanceMeters: 1 } },
    ]);
  }

  return Vendor.find({ ...baseQuery, "business.pincode": new RegExp(pin) })
    .select("name vendorCode business")
    .lean();
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
      .sort({ name: 1 })
      .lean();

    // Only surface sub-categories that actually have something to show.
    // `Material.subCategory` is optional (the admin form marks it so), so a
    // category can easily carry sub-categories that no material is linked
    // to. Listing those produced dead filter chips in the customer app — tap
    // "CEMENT" and get an empty screen even though the category clearly has
    // cement in it. Hiding the empty ones keeps every chip meaningful.
    const nonEmptyIds = await Material.distinct("subCategory", {
      category: id,
      subCategory: { $in: subCategories.map((s) => s._id) },
      isDeleted: false,
      status: "active",
    });
    const nonEmpty = new Set(nonEmptyIds.map((v: any) => String(v)));

    res.json({
      success: true,
      data: subCategories.filter((s: any) => nonEmpty.has(String(s._id))),
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

    // Optional: when present, each listing gains a supplier summary for that
    // delivery area (see below).
    const deliveryPin =
      String(req.query.pincode || "").match(/\d{6}/)?.[0] || null;
    // With `expandVendors=1` (and a pincode) the response lists one row per
    // VENDOR OFFER instead of one per product — a search for "cement" then
    // shows each supplier selling it as its own result.
    const expandVendors =
      !!deliveryPin &&
      ["1", "true", "yes"].includes(
        String(req.query.expandVendors || "").toLowerCase(),
      );

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

    // Supplier summary: when the customer tells us where they want delivery,
    // every listing carries "from <price> · N suppliers · <ETA>" so they can
    // see availability and the real starting price without opening each
    // product. Omitted entirely when no pincode is supplied, so existing
    // callers get exactly the payload they got before.
    let data: any[] = materials;
    if (deliveryPin) {
      const materialIds = materials.map((m: any) => m._id);
      const stocking = await VendorMaterial.find({
        material: { $in: materialIds },
        isAvailable: true,
        verificationStatus: CUSTOMER_VISIBLE_VERIFICATION,
      })
        .select("vendor material customerPrice minOrderQty maxOrderQty")
        .lean();

      const servingVendors = await resolveVendorsForPincode(
        deliveryPin,
        Array.from(new Set(stocking.map((s: any) => String(s.vendor)))).map(
          (v) => new mongoose.Types.ObjectId(v),
        ),
      );
      const vendorById = new Map(
        servingVendors.map((v: any) => [String(v._id), v]),
      );

      // One entry per (material, vendor-who-can-deliver-here).
      const offersByMaterial = new Map<string, any[]>();

      stocking.forEach((row: any) => {
        const vendorKey = String(row.vendor);
        const vendor = vendorById.get(vendorKey);
        if (!vendor) return; // this vendor cannot serve the delivery pincode

        const materialKey = String(row.material);
        const catalog = materials.find(
          (m: any) => String(m._id) === materialKey,
        ) as any;
        const price =
          row.customerPrice ??
          catalog?.finalSellingPrice ??
          catalog?.sellingPrice ??
          null;
        if (price == null) return;

        const distanceKm =
          vendor.distanceMeters != null
            ? +(vendor.distanceMeters / 1000).toFixed(1)
            : null;
        const samePincode = String(vendor.business?.pincode || "").includes(
          deliveryPin,
        );

        const list = offersByMaterial.get(materialKey) || [];
        list.push({
          vendorId: vendor._id,
          vendorCode: customerFacingVendorLabel(vendor),
          price,
          minOrderQty: row.minOrderQty ?? catalog?.minOrderQty ?? 1,
          maxOrderQty: row.maxOrderQty ?? null,
          distanceKm,
          samePincode,
          deliveryEstimate: deliveryEstimateForDistance(distanceKm, samePincode),
          deliveryEtaHours: deliveryEtaHoursForDistance(distanceKm, samePincode),
        });
        offersByMaterial.set(materialKey, list);
      });

      // Nearest-first within a material, same ordering the comparison screen
      // uses so the two surfaces never disagree about who is "closest".
      offersByMaterial.forEach((list) =>
        list.sort((a, b) => {
          if (a.samePincode !== b.samePincode) return a.samePincode ? -1 : 1;
          if (a.distanceKm != null && b.distanceKm != null) {
            if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
          } else if (a.distanceKm != null) return -1;
          else if (b.distanceKm != null) return 1;
          return a.price - b.price;
        }),
      );

      const plainOf = (m: any) =>
        typeof m.toObject === "function" ? m.toObject() : m;

      if (expandVendors) {
        // One row PER VENDOR OFFER rather than per product, so a search for
        // "cement" lists every supplier selling it. A product nobody stocks
        // in this area still gets a single catalog-priced row, otherwise it
        // would silently disappear from search results.
        data = materials.flatMap((m: any) => {
          const plain = plainOf(m);
          const offers = offersByMaterial.get(String(m._id)) || [];
          if (offers.length === 0) {
            return [
              {
                ...plain,
                offerKey: `${plain._id}:`,
                vendor: null,
                supplierCount: 0,
              },
            ];
          }
          return offers.map((o) => ({
            ...plain,
            // Stable key for list rendering: the same material appears once
            // per vendor, so `_id` alone is no longer unique in this list.
            offerKey: `${plain._id}:${o.vendorId}`,
            // The price THIS vendor charges, which is what checkout bills
            // when the line is bound to them.
            finalSellingPrice: o.price,
            minOrderQty: o.minOrderQty,
            vendor: {
              id: o.vendorId,
              code: o.vendorCode,
              distanceKm: o.distanceKm,
              samePincode: o.samePincode,
              deliveryEstimate: o.deliveryEstimate,
              deliveryEtaHours: o.deliveryEtaHours,
            },
            supplierCount: offers.length,
          }));
        });
      } else {
        // Summary mode (unchanged): one row per product with a
        // "from ₹X · N suppliers · ETA" line.
        data = materials.map((m: any) => {
          const plain = plainOf(m);
          const offers = offersByMaterial.get(String(m._id)) || [];
          if (offers.length === 0) {
            return {
              ...plain,
              supplierSummary: {
                count: 0,
                fromPrice: null,
                bestEtaHours: null,
                bestEtaLabel: null,
              },
            };
          }
          const fromPrice = Math.min(...offers.map((o) => o.price));
          const etas = offers
            .map((o) => o.deliveryEtaHours)
            .filter((h): h is number => h != null);
          const bestEtaHours = etas.length ? Math.min(...etas) : null;
          return {
            ...plain,
            supplierSummary: {
              count: offers.length,
              fromPrice,
              bestEtaHours,
              bestEtaLabel:
                bestEtaHours != null
                  ? `Delivers within ${bestEtaHours} hours`
                  : "Delivery time confirmed on order",
            },
          };
        });
      }
    }

    res.json({
      success: true,
      data,
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
/**
 * GET /api/mobile/catalog/vendors/:id
 *
 * Public storefront for one vendor: who they are and everything they stock
 * that a customer may buy, so a customer can browse a supplier directly
 * instead of only meeting them through a single material's comparison list.
 *
 * Confidentiality: `VendorMaterial.price` is the Vendor -> OTG COST rate and
 * is never selected here. The customer sees `customerPrice`, falling back to
 * the master catalog price — exactly the number checkout will charge.
 */
export const getVendorStorefront = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Vendor not found", 404);
    }

    const vendor = await Vendor.findOne({
      _id: id,
      status: "active",
      approvalStatus: "approved",
      isDeleted: false,
    })
      .select("business.city business.pincode vendorCode")
      .lean();

    if (!vendor) throw new AppError("Vendor not found", 404);

    const stocking = await VendorMaterial.find({
      vendor: id,
      isAvailable: true,
      verificationStatus: CUSTOMER_VISIBLE_VERIFICATION,
    })
      .select("material customerPrice minOrderQty maxOrderQty specs")
      .populate({
        path: "material",
        select:
          "name images brand category subCategory unit finalSellingPrice sellingPrice gst requestQuote transportation minOrderQty status isDeleted",
        populate: [
          { path: "category", select: "name" },
          { path: "subCategory", select: "name" },
        ],
      })
      .lean();

    const materials = stocking
      // A vendor row can outlive its master material being delisted.
      .filter(
        (row: any) =>
          row.material &&
          row.material.status === "active" &&
          !row.material.isDeleted,
      )
      .map((row: any) => {
        const m = row.material;
        return {
          ...m,
          // The price this vendor sells at — overrides the catalog price.
          finalSellingPrice:
            row.customerPrice ?? m.finalSellingPrice ?? m.sellingPrice ?? 0,
          vendorPrice: row.customerPrice ?? null,
          minOrderQty: row.minOrderQty ?? m.minOrderQty ?? 1,
          maxOrderQty: row.maxOrderQty ?? null,
          specs: row.specs ?? m.specs,
        };
      });

    res.json({
      success: true,
      data: {
        vendor: {
          _id: vendor._id,
          // Code, never the trading name — see customerFacingVendorLabel.
          code: customerFacingVendorLabel(vendor),
          city: (vendor as any).business?.city || null,
          pincode: (vendor as any).business?.pincode || null,
        },
        materials,
        total: materials.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

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

    // Sorting / filtering controls (F: "filter or sort vendors based on
    // product prices" and "... on delivery time"). All optional; the default
    // preserves the previous recommended ordering exactly.
    const ALLOWED_SORTS = [
      "recommended",
      "price_asc",
      "price_desc",
      "delivery",
      "distance",
    ] as const;
    const requestedSort = String(req.query.sort || "recommended");
    const sort = (ALLOWED_SORTS as readonly string[]).includes(requestedSort)
      ? requestedSort
      : "recommended";

    const parsePositive = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const maxPrice = parsePositive(req.query.maxPrice);
    const maxDeliveryHours = parsePositive(req.query.maxDeliveryHours);

    const stocking = await VendorMaterial.find({
      material: id,
      isAvailable: true,
      verificationStatus: CUSTOMER_VISIBLE_VERIFICATION,
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

    const vendors = await resolveVendorsForPincode(pin, vendorIds);

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
          vendorCode: customerFacingVendorLabel(v),
          // Customer-facing price only. `rate.price` (Vendor -> OTG) is
          // deliberately NOT exposed here — it is OTG's cost and margin.
          price: rate?.customerPrice ?? catalogPrice,
          minOrderQty: rate?.minOrderQty ?? 1,
          maxOrderQty: rate?.maxOrderQty ?? null,
          distanceKm,
          samePincode,
          deliveryEstimate: deliveryEstimateForDistance(distanceKm, samePincode),
          deliveryEtaHours: deliveryEtaHoursForDistance(distanceKm, samePincode),
        };
      })
      .filter((r) => r.price != null)
      // Price ceiling, so "show me options under X" is answerable.
      .filter((r) => maxPrice == null || (r.price as number) <= maxPrice)
      // Delivery ceiling: "only vendors who can deliver within N hours".
      // Vendors with no committed ETA are excluded when a limit is asked
      // for — an unknown ETA cannot satisfy a promise.
      .filter(
        (r) =>
          maxDeliveryHours == null ||
          (r.deliveryEtaHours != null && r.deliveryEtaHours <= maxDeliveryHours),
      )
      .sort((a, b) => {
        // Nulls always sink, whatever the chosen ordering.
        const byPrice = (a.price ?? 0) - (b.price ?? 0);
        const byEta = () => {
          const ax = a.deliveryEtaHours;
          const bx = b.deliveryEtaHours;
          if (ax == null && bx == null) return 0;
          if (ax == null) return 1;
          if (bx == null) return -1;
          return ax - bx;
        };
        const byDistance = () => {
          if (a.distanceKm != null && b.distanceKm != null) {
            return a.distanceKm - b.distanceKm;
          }
          if (a.distanceKm != null) return -1;
          if (b.distanceKm != null) return 1;
          return 0;
        };

        if (sort === "price_asc") return byPrice || byDistance();
        if (sort === "price_desc") return -byPrice || byDistance();
        if (sort === "delivery") return byEta() || byDistance() || byPrice;
        if (sort === "distance") return byDistance() || byPrice;

        // "recommended" (default): same-pincode first, then nearest, then
        // cheapest — the ordering the comparison screen has always used.
        if (a.samePincode !== b.samePincode) return a.samePincode ? -1 : 1;
        return byDistance() || byPrice;
      });

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};
