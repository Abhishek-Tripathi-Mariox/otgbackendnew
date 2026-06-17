import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.model";
import { AppError } from "../middlewares/errorHandler";
import { uploadBufferToS3 } from "../config/s3";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const OTP_EXPIRY_SECONDS = 45; // OTP expires after 45 seconds
const MAX_OTP_ATTEMPTS = 5;

// Generate 6 digit OTP
const generateOTP = (): string => {
  // TODO: Use random OTP in production
  return "123456";
};

// Generate JWT token for user
const generateUserToken = (userId: string): string => {
  return jwt.sign({ id: userId, type: "user" }, JWT_SECRET, {
    expiresIn: "30d",
  });
};

/**
 * Send OTP to mobile number
 * POST /api/mobile/auth/send-otp
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

    // Validate mobile number format (10 digits for India)
    const mobileRegex = /^[6-9]\d{9}$/;
    if (!mobileRegex.test(mobile)) {
      throw new AppError("Invalid mobile number format", 400);
    }

    // Find or create user
    let user = await User.findOne({ mobile, isDeleted: false });

    if (user) {
      // Check if user is blocked
      if (user.status === "blocked") {
        throw new AppError(
          "Your account has been blocked. Please contact support.",
          403,
        );
      }

      // Check OTP attempts (prevent brute force)
      if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
        const lastAttemptTime = user.otpExpiry
          ? new Date(user.otpExpiry).getTime()
          : 0;
        const currentTime = Date.now();
        const cooldownPeriod = 15 * 60 * 1000; // 15 minutes cooldown

        if (currentTime - lastAttemptTime < cooldownPeriod) {
          throw new AppError(
            "Too many OTP requests. Please try again after 15 minutes.",
            429,
          );
        } else {
          // Reset attempts after cooldown
          user.otpAttempts = 0;
        }
      }
    } else {
      // Create new user
      user = new User({
        mobile,
        status: "active",
        isVerified: false,
        deviceInfo: {
          deviceId,
          deviceType,
        },
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    // Save OTP to user
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    user.otpAttempts = (user.otpAttempts || 0) + 1;

    // Update device info
    if (deviceId || deviceType) {
      user.deviceInfo = {
        ...user.deviceInfo,
        deviceId: deviceId || user.deviceInfo?.deviceId,
        deviceType: deviceType || user.deviceInfo?.deviceType,
      };
    }

    await user.save();

    // TODO: Send OTP via SMS service (Twilio, MSG91, etc.)
    // For now, we'll log it (remove in production)
    console.log(`OTP for ${mobile}: ${otp}`);

    // In production, you would integrate with SMS service:
    // await sendSMS(mobile, `Your OTP for OTG is: ${otp}. Valid for 45 seconds.`);

    res.json({
      success: true,
      message: "OTP sent successfully",
      data: {
        mobile,
        expiresIn: OTP_EXPIRY_SECONDS,
        isNewUser: !user.isVerified,
        // Remove in production - only for development/testing
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify OTP and login/register user
 * POST /api/mobile/auth/verify-otp
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

    // Find user
    const user = await User.findOne({ mobile, isDeleted: false });

    if (!user) {
      throw new AppError("User not found. Please request OTP first.", 404);
    }

    // Check if user is blocked
    if (user.status === "blocked") {
      throw new AppError(
        "Your account has been blocked. Please contact support.",
        403,
      );
    }

    // Check if OTP exists
    if (!user.otp || !user.otpExpiry) {
      throw new AppError("No OTP found. Please request a new OTP.", 400);
    }

    // Check if OTP is expired
    if (new Date() > user.otpExpiry) {
      throw new AppError("OTP has expired. Please request a new OTP.", 400);
    }

    // Verify OTP
    if (user.otp !== otp) {
      throw new AppError("Invalid OTP. Please try again.", 400);
    }

    // Clear OTP after successful verification
    user.otp = undefined;
    user.otpExpiry = undefined;
    user.otpAttempts = 0;

    // Mark user as verified
    user.isVerified = true;

    // Update device info
    user.deviceInfo = {
      ...user.deviceInfo,
      deviceId: deviceId || user.deviceInfo?.deviceId,
      deviceType: deviceType || user.deviceInfo?.deviceType,
      fcmToken: fcmToken || user.deviceInfo?.fcmToken,
      lastLoginAt: new Date(),
    };

    await user.save();

    // Generate JWT token
    const token = generateUserToken(user._id.toString());

    res.json({
      success: true,
      message: user.name ? "Login successful" : "Verification successful",
      data: {
        token,
        user: {
          _id: user._id,
          name: user.name,
          mobile: user.mobile,
          email: user.email,
          profileImage: user.profileImage,
          address: user.address,
          status: user.status,
          isVerified: user.isVerified,
          isNewUser: !user.name, // If no name, user needs to complete profile
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Resend OTP
 * POST /api/mobile/auth/resend-otp
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

    // Find user
    const user = await User.findOne({ mobile, isDeleted: false });

    if (!user) {
      throw new AppError("User not found. Please request OTP first.", 404);
    }

    // Check if user is blocked
    if (user.status === "blocked") {
      throw new AppError(
        "Your account has been blocked. Please contact support.",
        403,
      );
    }

    // Check OTP attempts (prevent brute force)
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      const lastAttemptTime = user.otpExpiry
        ? new Date(user.otpExpiry).getTime()
        : 0;
      const currentTime = Date.now();
      const cooldownPeriod = 15 * 60 * 1000; // 15 minutes cooldown

      if (currentTime - lastAttemptTime < cooldownPeriod) {
        throw new AppError(
          "Too many OTP requests. Please try again after 15 minutes.",
          429,
        );
      } else {
        // Reset attempts after cooldown
        user.otpAttempts = 0;
      }
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    // Save OTP
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    user.otpAttempts = (user.otpAttempts || 0) + 1;

    // Update device info
    if (deviceId || deviceType) {
      user.deviceInfo = {
        ...user.deviceInfo,
        deviceId: deviceId || user.deviceInfo?.deviceId,
        deviceType: deviceType || user.deviceInfo?.deviceType,
      };
    }

    await user.save();

    // TODO: Send OTP via SMS service
    console.log(`Resend OTP for ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: "OTP resent successfully",
      data: {
        mobile,
        expiresIn: OTP_EXPIRY_SECONDS,
        attemptsRemaining: MAX_OTP_ATTEMPTS - user.otpAttempts,
        // Remove in production
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user profile (authenticated)
 * GET /api/mobile/auth/me
 */
export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new AppError("Unauthorized", 401);
    }

    const user = await User.findById(userId).select(
      "-otp -otpExpiry -otpAttempts",
    );

    if (!user || user.isDeleted) {
      throw new AppError("User not found", 404);
    }

    if (user.status === "blocked") {
      throw new AppError("Your account has been blocked", 403);
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user profile (authenticated)
 * PUT /api/mobile/auth/profile
 */
export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { name, email, profileImage } = req.body;
    // address may come as JSON string from FormData
    let address = req.body.address;
    if (typeof address === 'string') {
      try { address = JSON.parse(address); } catch { address = undefined; }
    }

    if (!userId) {
      throw new AppError("Unauthorized", 401);
    }

    const user = await User.findById(userId);

    if (!user || user.isDeleted) {
      throw new AppError("User not found", 404);
    }

    if (user.status === "blocked") {
      throw new AppError("Your account has been blocked", 403);
    }

    // Update allowed fields
    if (name) user.name = name;
    if (email !== undefined) user.email = email || undefined;

    // Handle profile image
    const { profileImageBase64, profileImageType } = req.body;
    const file = (req as any).file;
    if (profileImageBase64) {
      // Base64 upload from mobile app
      const mimeType = profileImageType || 'image/jpeg';
      const buffer = Buffer.from(profileImageBase64, 'base64');
      user.profileImage = await uploadBufferToS3(buffer, 'profile-images', mimeType);
    } else if (file) {
      // Multer file upload fallback (admin panel / web)
      const region = process.env.AWS_REGION || 'ap-south-1';
      const bucket = file.bucket || process.env.AWS_S3_BUCKET_NAME;
      user.profileImage = file.key
        ? `https://${bucket}.s3.${region}.amazonaws.com/${file.key}`
        : file.location;
    } else if (profileImage !== undefined) {
      user.profileImage = profileImage || undefined;
    }

    // Update address
    if (address) {
      const updatedAddress: any = {
        street: address.street ?? user.address?.street,
        city: address.city ?? user.address?.city,
        state: address.state ?? user.address?.state,
        pincode: address.pincode ?? user.address?.pincode,
      };

      // Only set location if it has valid coordinates
      if (
        address.location &&
        address.location.type === "Point" &&
        Array.isArray(address.location.coordinates) &&
        address.location.coordinates.length === 2 &&
        typeof address.location.coordinates[0] === "number" &&
        typeof address.location.coordinates[1] === "number"
      ) {
        updatedAddress.location = address.location;
      } else if (
        user.address?.location?.coordinates &&
        user.address.location.coordinates.length === 2
      ) {
        updatedAddress.location = user.address.location;
      }

      user.address = updatedAddress;
    }

    await user.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    next(error);
  }
};

/**
 * Update FCM token (authenticated)
 * PUT /api/mobile/auth/fcm-token
 */
export const updateFCMToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { fcmToken } = req.body;

    if (!userId) {
      throw new AppError("Unauthorized", 401);
    }

    if (!fcmToken) {
      throw new AppError("FCM token is required", 400);
    }

    const user = await User.findById(userId);

    if (!user || user.isDeleted) {
      throw new AppError("User not found", 404);
    }

    user.deviceInfo = {
      ...user.deviceInfo,
      fcmToken,
    };

    await user.save();

    res.json({
      success: true,
      message: "FCM token updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Load the authenticated user, guarding for missing/blocked accounts.
 */
const loadActiveUser = async (userId?: string) => {
  if (!userId) throw new AppError("Unauthorized", 401);
  const user = await User.findById(userId);
  if (!user || user.isDeleted) throw new AppError("User not found", 404);
  if (user.status === "blocked") {
    throw new AppError("Your account has been blocked", 403);
  }
  return user;
};

/**
 * List saved addresses (authenticated)
 * GET /api/mobile/auth/addresses
 */
export const listAddresses = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await loadActiveUser((req as any).user?.id);
    res.json({ success: true, data: user.addresses || [] });
  } catch (error) {
    next(error);
  }
};

/**
 * Add a saved address (authenticated)
 * POST /api/mobile/auth/addresses  body: { label, line, lat?, lng?, isDefault? }
 */
export const addAddress = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await loadActiveUser((req as any).user?.id);
    const { label, line, lat, lng, isDefault } = req.body || {};

    if (!line) throw new AppError("Address line is required", 400);

    if (!Array.isArray(user.addresses)) user.addresses = [];

    // First address is default by default; an explicit isDefault demotes others.
    const makeDefault = isDefault === true || user.addresses.length === 0;
    if (makeDefault) {
      user.addresses.forEach(a => {
        a.isDefault = false;
      });
    }

    user.addresses.push({
      label: label || undefined,
      line,
      lat: typeof lat === "number" ? lat : undefined,
      lng: typeof lng === "number" ? lng : undefined,
      isDefault: makeDefault,
    });

    await user.save();
    res.status(201).json({ success: true, data: user.addresses });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a saved address (authenticated)
 * PUT /api/mobile/auth/addresses/:addrId
 */
export const updateAddress = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await loadActiveUser((req as any).user?.id);
    const { addrId } = req.params;
    const { label, line, lat, lng, isDefault } = req.body || {};

    const addr = (user.addresses as any)?.id?.(addrId);
    if (!addr) throw new AppError("Address not found", 404);

    if (label !== undefined) addr.label = label || undefined;
    if (line !== undefined) addr.line = line;
    if (lat !== undefined) addr.lat = typeof lat === "number" ? lat : undefined;
    if (lng !== undefined) addr.lng = typeof lng === "number" ? lng : undefined;

    if (isDefault === true) {
      user.addresses!.forEach(a => {
        a.isDefault = false;
      });
      addr.isDefault = true;
    }

    await user.save();
    res.json({ success: true, data: user.addresses });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a saved address (authenticated)
 * DELETE /api/mobile/auth/addresses/:addrId
 */
export const deleteAddress = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await loadActiveUser((req as any).user?.id);
    const { addrId } = req.params;

    const addr = (user.addresses as any)?.id?.(addrId);
    if (!addr) throw new AppError("Address not found", 404);

    const wasDefault = addr.isDefault;
    addr.deleteOne();

    // Promote the first remaining address to default if we removed the default.
    if (wasDefault && user.addresses && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    res.json({ success: true, data: user.addresses });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout (authenticated)
 * POST /api/mobile/auth/logout
 */
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new AppError("Unauthorized", 401);
    }

    const user = await User.findById(userId);

    if (user) {
      // Clear FCM token on logout
      user.deviceInfo = {
        ...user.deviceInfo,
        fcmToken: undefined,
      };
      await user.save();
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};
