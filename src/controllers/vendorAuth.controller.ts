import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Vendor, { advanceVendorStep } from "../models/Vendor.model";
import Booking from "../models/Booking.model";
import Notification from "../models/Notification.model";
import SupportTicket from "../models/SupportTicket.model";
import HelpSettings from "../models/HelpSettings.model";
import { AppError } from "../middlewares/errorHandler";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const OTP_EXPIRY_SECONDS = 45;
const MAX_OTP_ATTEMPTS = 5;

const generateOTP = (): string => {
  // TODO: Use random OTP in production
  return "123456";
};

const generateVendorToken = (vendorId: string): string => {
  return jwt.sign({ id: vendorId, type: "vendor" }, JWT_SECRET, {
    expiresIn: "30d",
  });
};

/**
 * Send OTP to vendor mobile number (Login)
 * Vendor must already be pre-registered by admin.
 * POST /api/vendor/auth/send-otp
 */
export const sendOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile, deviceId, deviceType } = req.body;

    if (!mobile) {
      throw new AppError("Mobile number is required", 400);
    }

    const mobileRegex = /^[6-9]\d{9}$/;
    if (!mobileRegex.test(mobile)) {
      throw new AppError("Invalid mobile number format", 400);
    }

    // Find-or-create: a brand-new mobile starts self-registration. The vendor
    // record is created here (so we have somewhere to store the OTP) but stays
    // unverified with an empty profile until they complete the steps. Profile
    // fields are optional on the model precisely to allow this partial record.
    let vendor = await Vendor.findOne({ mobile, isDeleted: false });

    if (!vendor) {
      vendor = new Vendor({
        mobile,
        status: "active",
        isVerified: false,
        // Self-registered vendors wait for admin approval before they can
        // operate (receive/claim orders). They can still log in & onboard.
        approvalStatus: "pending",
        addedByAdmin: false,
        onboardingStep: "business",
      });
    }

    if (vendor.status === "inactive") {
      throw new AppError(
        "Your account is inactive. Please contact support.",
        403,
      );
    }

    if (vendor.otpAttempts >= MAX_OTP_ATTEMPTS) {
      const lastAttemptTime = vendor.otpExpiry
        ? new Date(vendor.otpExpiry).getTime()
        : 0;
      const currentTime = Date.now();
      const cooldownPeriod = 15 * 60 * 1000;

      if (currentTime - lastAttemptTime < cooldownPeriod) {
        throw new AppError(
          "Too many OTP requests. Please try again after 15 minutes.",
          429,
        );
      } else {
        vendor.otpAttempts = 0;
      }
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    vendor.otp = otp;
    vendor.otpExpiry = otpExpiry;
    vendor.otpAttempts = (vendor.otpAttempts || 0) + 1;

    if (deviceId || deviceType) {
      vendor.deviceInfo = {
        ...vendor.deviceInfo,
        deviceId: deviceId || vendor.deviceInfo?.deviceId,
        deviceType: deviceType || vendor.deviceInfo?.deviceType,
      };
    }

    await vendor.save();

    // TODO: Send OTP via SMS service (Twilio, MSG91, etc.)
    console.log(`OTP for vendor ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: "OTP sent successfully",
      data: {
        mobile,
        expiresIn: OTP_EXPIRY_SECONDS,
        isNewVendor: !vendor.isVerified,
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify OTP and login/register vendor
 * POST /api/vendor/auth/verify-otp
 */
export const verifyOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile, otp, fcmToken, deviceId, deviceType } = req.body;

    if (!mobile || !otp) {
      throw new AppError("Mobile number and OTP are required", 400);
    }

    const vendor = await Vendor.findOne({ mobile, isDeleted: false });

    if (!vendor) {
      throw new AppError(
        "No vendor account found. Please register.",
        404,
      );
    }

    if (vendor.status === "inactive") {
      throw new AppError(
        "Your account is inactive. Please contact support.",
        403,
      );
    }

    if (!vendor.otp || !vendor.otpExpiry) {
      throw new AppError("No OTP found. Please request a new OTP.", 400);
    }

    if (new Date() > vendor.otpExpiry) {
      throw new AppError("OTP has expired. Please request a new OTP.", 400);
    }

    if (vendor.otp !== otp) {
      throw new AppError("Invalid OTP. Please try again.", 400);
    }

    vendor.otp = undefined;
    vendor.otpExpiry = undefined;
    vendor.otpAttempts = 0;
    vendor.isVerified = true;

    vendor.deviceInfo = {
      ...vendor.deviceInfo,
      deviceId: deviceId || vendor.deviceInfo?.deviceId,
      deviceType: deviceType || vendor.deviceInfo?.deviceType,
      fcmToken: fcmToken || vendor.deviceInfo?.fcmToken,
      lastLoginAt: new Date(),
    };

    await vendor.save();

    const token = generateVendorToken(vendor._id.toString());

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        vendor: {
          _id: vendor._id,
          vendorCode: vendor.vendorCode,
          name: vendor.name,
          mobile: vendor.mobile,
          email: vendor.email,
          business: vendor.business,
          bankDetails: vendor.bankDetails,
          categories: vendor.categories,
          onboardingStep: vendor.onboardingStep,
          status: vendor.status,
          isVerified: vendor.isVerified,
          addedByAdmin: vendor.addedByAdmin,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Resend OTP
 * POST /api/vendor/auth/resend-otp
 */
export const resendOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile, deviceId, deviceType } = req.body;

    if (!mobile) {
      throw new AppError("Mobile number is required", 400);
    }

    const vendor = await Vendor.findOne({ mobile, isDeleted: false });

    if (!vendor) {
      throw new AppError(
        "No vendor account found for this mobile number.",
        404,
      );
    }

    if (vendor.status === "inactive") {
      throw new AppError(
        "Your account is inactive. Please contact support.",
        403,
      );
    }

    if (vendor.otpAttempts >= MAX_OTP_ATTEMPTS) {
      const lastAttemptTime = vendor.otpExpiry
        ? new Date(vendor.otpExpiry).getTime()
        : 0;
      const currentTime = Date.now();
      const cooldownPeriod = 15 * 60 * 1000;

      if (currentTime - lastAttemptTime < cooldownPeriod) {
        throw new AppError(
          "Too many OTP requests. Please try again after 15 minutes.",
          429,
        );
      } else {
        vendor.otpAttempts = 0;
      }
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    vendor.otp = otp;
    vendor.otpExpiry = otpExpiry;
    vendor.otpAttempts = (vendor.otpAttempts || 0) + 1;

    if (deviceId || deviceType) {
      vendor.deviceInfo = {
        ...vendor.deviceInfo,
        deviceId: deviceId || vendor.deviceInfo?.deviceId,
        deviceType: deviceType || vendor.deviceInfo?.deviceType,
      };
    }

    await vendor.save();

    // TODO: Send OTP via SMS service
    console.log(`Resend OTP for vendor ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: "OTP resent successfully",
      data: {
        mobile,
        expiresIn: OTP_EXPIRY_SECONDS,
        attemptsRemaining: MAX_OTP_ATTEMPTS - vendor.otpAttempts,
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Load the authenticated, onboarding vendor document for the step endpoints.
 */
const loadOnboardingVendor = async (req: Request) => {
  const vendorId = (req as any).vendor?.id;
  if (!vendorId) throw new AppError("Unauthorized", 401);
  const vendor = await Vendor.findById(vendorId);
  if (!vendor || vendor.isDeleted) throw new AppError("Vendor not found", 404);
  return vendor;
};

const onboardingResponse = (vendor: any) => ({
  success: true,
  data: { onboardingStep: vendor.onboardingStep, vendor },
});

/**
 * POST /api/vendor/auth/onboarding/business  (Registration step 1)
 * Saves business basics and advances onboardingStep -> categories.
 */
export const saveBusinessStep = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await loadOnboardingVendor(req);
    const { name, businessName, businessType, address, gstNumber, location } =
      req.body || {};

    if (typeof name === "string" && name.trim()) vendor.name = name.trim();
    if (typeof businessName === "string")
      vendor.business.name = businessName.trim();
    else if (typeof name === "string" && name.trim() && !vendor.business.name)
      vendor.business.name = name.trim();
    if (typeof businessType === "string")
      vendor.business.type = businessType.trim();
    if (typeof address === "string") vendor.business.address = address.trim();
    if (typeof gstNumber === "string")
      vendor.business.gstNumber = gstNumber.trim();

    if (
      location &&
      Array.isArray(location.coordinates) &&
      location.coordinates.length === 2
    ) {
      vendor.set("location", {
        type: "Point",
        coordinates: location.coordinates,
        address:
          typeof location.address === "string"
            ? location.address
            : vendor.location?.address,
      });
    }

    vendor.onboardingStep = advanceVendorStep(vendor.onboardingStep, "business");
    await vendor.save();
    res.json(onboardingResponse(vendor));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/vendor/auth/onboarding/categories  (Registration step 2)
 * Saves supplied categories and advances onboardingStep -> documents.
 */
export const saveCategoriesStep = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await loadOnboardingVendor(req);
    const { categories } = req.body || {};
    if (Array.isArray(categories)) {
      vendor.categories = categories
        .filter((c: unknown) => mongoose.isValidObjectId(c))
        .map((c: string) => new mongoose.Types.ObjectId(c));
    }
    vendor.onboardingStep = advanceVendorStep(
      vendor.onboardingStep,
      "categories",
    );
    await vendor.save();
    res.json(onboardingResponse(vendor));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/vendor/auth/onboarding/documents  (Registration step 3 / submit)
 * Saves document URLs and advances onboardingStep -> completed.
 */
export const submitDocumentsStep = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await loadOnboardingVendor(req);
    const { documents } = req.body || {};
    if (documents && typeof documents === "object") {
      vendor.documents = {
        gstCertificate:
          documents.gstCertificate ?? vendor.documents?.gstCertificate,
        panCard: documents.panCard ?? vendor.documents?.panCard,
        tradeLicense: documents.tradeLicense ?? vendor.documents?.tradeLicense,
        bankCheque: documents.bankCheque ?? vendor.documents?.bankCheque,
      };
    }
    vendor.onboardingStep = advanceVendorStep(
      vendor.onboardingStep,
      "documents",
    );
    // A self-registered vendor that just finished onboarding awaits admin
    // approval. Don't downgrade one an admin already approved.
    if (vendor.approvalStatus !== "approved") {
      vendor.approvalStatus = "pending";
    }
    await vendor.save();
    res.json(onboardingResponse(vendor));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/vendor/auth/onboarding/reapply
 * A rejected vendor re-submits (optionally with updated documents). Moves the
 * application back to "pending" for the admin to review again.
 */
export const reapplyVendor = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendor = await loadOnboardingVendor(req);
    const { documents } = req.body || {};
    if (documents && typeof documents === "object") {
      vendor.documents = {
        gstCertificate:
          documents.gstCertificate ?? vendor.documents?.gstCertificate,
        panCard: documents.panCard ?? vendor.documents?.panCard,
        tradeLicense: documents.tradeLicense ?? vendor.documents?.tradeLicense,
        bankCheque: documents.bankCheque ?? vendor.documents?.bankCheque,
      };
    }
    vendor.approvalStatus = "pending";
    vendor.rejectionReason = undefined;
    vendor.onboardingStep = "completed";
    await vendor.save();
    res.json(onboardingResponse(vendor));
  } catch (error) {
    next(error);
  }
};

/**
 * Get authenticated vendor profile
 * GET /api/vendor/auth/me
 */
export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;

    if (!vendorId) {
      throw new AppError("Unauthorized", 401);
    }

    const vendor = await Vendor.findById(vendorId).select(
      "-otp -otpExpiry -otpAttempts",
    );

    if (!vendor || vendor.isDeleted) {
      throw new AppError("Vendor not found", 404);
    }

    if (vendor.status === "inactive") {
      throw new AppError("Your account is inactive", 403);
    }

    res.json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout
 * POST /api/vendor/auth/logout
 */
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;

    if (!vendorId) {
      throw new AppError("Unauthorized", 401);
    }

    const vendor = await Vendor.findById(vendorId);

    if (vendor) {
      vendor.deviceInfo = {
        ...vendor.deviceInfo,
        fcmToken: undefined,
      };
      await vendor.save();
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update authenticated vendor profile (self-service)
 * PUT /api/vendor/auth/me
 *
 * Allows the logged-in vendor to update their own basic profile fields.
 * Does NOT permit changing mobile (login identifier), status, verification,
 * vendorCode, or admin-only flags.
 */
export const updateMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;

    if (!vendorId) {
      throw new AppError("Unauthorized", 401);
    }

    const vendor = await Vendor.findById(vendorId);

    if (!vendor || vendor.isDeleted) {
      throw new AppError("Vendor not found", 404);
    }

    const { name, email, business, bankDetails } = req.body || {};

    if (typeof name === "string" && name.trim()) {
      vendor.name = name.trim();
    }

    if (typeof email === "string") {
      vendor.email = email.trim().toLowerCase() || undefined;
    }

    if (business && typeof business === "object") {
      const allowed = [
        "name",
        "gstNumber",
        "panNumber",
        "address",
        "city",
        "state",
        "pincode",
      ] as const;
      for (const key of allowed) {
        const incoming = (business as any)[key];
        if (typeof incoming === "string") {
          (vendor.business as any)[key] = incoming.trim();
        }
      }
    }

    if (bankDetails && typeof bankDetails === "object") {
      const allowed = [
        "accountHolderName",
        "accountNumber",
        "bankName",
        "ifscCode",
        "branchName",
      ] as const;
      for (const key of allowed) {
        const incoming = (bankDetails as any)[key];
        if (typeof incoming === "string") {
          (vendor.bankDetails as any)[key] = incoming.trim();
        }
      }
    }

    await vendor.save();

    const sanitized = await Vendor.findById(vendor._id).select(
      "-otp -otpExpiry -otpAttempts",
    );

    res.json({
      success: true,
      data: sanitized,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Build the mongo query matching all notifications visible to the given vendor.
 * Visible = sent + not globally deleted + not deleted by this vendor +
 * targeted at "all" / "vendors" / "specific (and this vendor is included)".
 */
const visibleNotificationsQuery = (vendorId: string) => {
  const objectId = new mongoose.Types.ObjectId(vendorId);
  return {
    isDeleted: false,
    status: "sent",
    deletedByVendors: { $ne: objectId },
    $or: [
      { targetType: "all" },
      { targetType: "vendors" },
      { targetType: "specific", "specificRecipients.vendors": objectId },
    ],
  };
};

/**
 * GET /api/vendor/auth/notifications
 * List notifications visible to the logged-in vendor, plus the unread count.
 */
export const listVendorNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const query = visibleNotificationsQuery(vendorId);
    const objectId = new mongoose.Types.ObjectId(vendorId);

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const items = notifications.map((n: any) => ({
      _id: n._id,
      title: n.title,
      message: n.message,
      targetType: n.targetType,
      createdAt: n.createdAt,
      sentAt: n.sentAt,
      unread: !(n.readByVendors || []).some((id: any) => id.equals(objectId)),
    }));

    const unreadCount = items.filter((n: any) => n.unread).length;

    res.json({
      success: true,
      data: items,
      meta: { unreadCount, total: items.length },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/auth/notifications/unread-count
 * Lightweight count-only endpoint for the global bell badge.
 */
export const getVendorUnreadCount = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const objectId = new mongoose.Types.ObjectId(vendorId);
    const unreadCount = await Notification.countDocuments({
      ...visibleNotificationsQuery(vendorId),
      readByVendors: { $ne: objectId },
    });

    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/vendor/auth/notifications/read-all
 * Mark every currently-visible notification as read for this vendor.
 */
export const markAllVendorNotificationsRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const query = visibleNotificationsQuery(vendorId);
    await Notification.updateMany(query, {
      $addToSet: { readByVendors: new mongoose.Types.ObjectId(vendorId) },
    });

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/vendor/auth/notifications/:id/read
 * Mark a single notification as read for this vendor.
 */
export const markVendorNotificationRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid notification id", 400);
    }

    await Notification.updateOne(
      { _id: id, isDeleted: false },
      { $addToSet: { readByVendors: new mongoose.Types.ObjectId(vendorId) } },
    );

    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/vendor/auth/notifications/:id
 * Soft-hide a notification for this vendor only (admin record remains intact).
 */
export const deleteVendorNotification = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError("Invalid notification id", 400);
    }

    await Notification.updateOne(
      { _id: id, isDeleted: false },
      {
        $addToSet: {
          deletedByVendors: new mongoose.Types.ObjectId(vendorId),
        },
      },
    );

    res.json({ success: true, message: "Notification removed" });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/auth/help-settings
 * Public help/support contact info (mirrors customer help.public.settings).
 */
export const getVendorHelpSettings = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const settings = await HelpSettings.findOne({ key: "default" }).lean();
    res.json({
      success: true,
      data: {
        address: settings?.address || null,
        mobile: settings?.mobile || null,
        email: settings?.email || null,
        whatsappNumber: settings?.whatsappNumber || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/vendor/auth/support
 * Vendor raises a support ticket. Reuses the SupportTicket model with
 * source="vendor" and the vendor's identity captured for admin context.
 */
export const createVendorSupportTicket = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const vendor = await Vendor.findById(vendorId);
    if (!vendor || vendor.isDeleted) {
      throw new AppError("Vendor not found", 404);
    }

    const { issueType, description, message } = req.body || {};
    const text = (description || message || "").toString().trim();
    if (!text) throw new AppError("Please describe the issue", 400);

    const ticket = await SupportTicket.create({
      vendor: vendor._id,
      source: "vendor",
      issueType: (issueType || "").toString().trim() || undefined,
      // `name` is required on the model. Vendors who haven't finished
      // onboarding may have neither a business name nor a contact name, which
      // would make ticket creation fail validation — fall back to the mobile.
      name:
        vendor.business?.name ||
        vendor.name ||
        `Vendor ${vendor.mobile}`,
      mobile: vendor.mobile,
      email: vendor.email,
      message: text,
      status: "open",
    });

    res.status(201).json({
      success: true,
      message: "Your issue has been submitted",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/auth/support
 * List the logged-in vendor's own support tickets.
 */
export const listVendorSupportTickets = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const tickets = await SupportTicket.find({ vendor: vendorId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/vendor/auth/dashboard
 * Aggregated stats for the logged-in vendor's dashboard:
 * - statCards: new orders, in progress, today's dispatch, pending payment
 * - operations: QC pending, ready for dispatch, in transit, delayed
 * - weeklyOrders: order counts for the last 7 days
 * - unreadNotifications: count for the bell badge
 */
export const getVendorDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const vendorId = (req as any).vendor?.id;
    if (!vendorId) throw new AppError("Unauthorized", 401);

    const vendorObjId = new mongoose.Types.ObjectId(vendorId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const baseMatch = { vendor: vendorObjId, isDeleted: false };

    const [statusCounts] = await Booking.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          newOrders: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          inProgress: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
          },
          inTransit: {
            $sum: { $cond: [{ $eq: ["$status", "in_transit"] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          pendingPayment: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "delivered"] },
                    { $ne: ["$paymentStatus", "completed"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const todayDispatchCount = await Booking.countDocuments({
      ...baseMatch,
      status: "in_transit",
      updatedAt: { $gte: todayStart, $lte: todayEnd },
    });

    const weeklyAgg = await Booking.aggregate([
      {
        $match: {
          ...baseMatch,
          createdAt: { $gte: weekStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const weeklyOrders: { date: string; orders: number }[] = [];
    const cursor = new Date(weekStart);
    while (cursor <= todayEnd) {
      const dateStr = cursor.toISOString().split("T")[0];
      const found = weeklyAgg.find((d: any) => d._id === dateStr);
      weeklyOrders.push({ date: dateStr, orders: found ? found.orders : 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    const unreadCount = await Notification.countDocuments({
      isDeleted: false,
      status: "sent",
      deletedByVendors: { $ne: vendorObjId },
      readByVendors: { $ne: vendorObjId },
      $or: [
        { targetType: "all" },
        { targetType: "vendors" },
        { targetType: "specific", "specificRecipients.vendors": vendorObjId },
      ],
    });

    const counts = statusCounts || {
      newOrders: 0,
      inProgress: 0,
      inTransit: 0,
      delivered: 0,
      pendingPayment: 0,
    };

    res.json({
      success: true,
      data: {
        statCards: {
          newOrders: counts.newOrders || 0,
          inProgress: counts.inProgress || 0,
          todayDispatch: todayDispatchCount,
          pendingPayment: counts.pendingPayment || 0,
        },
        operations: {
          qcPending: counts.newOrders || 0,
          readyForDispatch: counts.inProgress || 0,
          inTransit: counts.inTransit || 0,
          delayed: 0,
        },
        weeklyOrders,
        unreadNotifications: unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
};
