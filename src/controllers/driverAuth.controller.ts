import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Driver from "../models/Driver.model";
import { AppError } from "../middlewares/errorHandler";
import { DriverRequest } from "../middlewares/driverAuth.middleware";
import { uploadBufferToS3 } from "../config/s3";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const OTP_EXPIRY_SECONDS = 45;
const MAX_OTP_ATTEMPTS = 5;

const generateOTP = (): string => "123456"; // TODO: random in prod

const generateDriverToken = (driverId: string): string =>
  jwt.sign({ id: driverId, type: "driver" }, JWT_SECRET, { expiresIn: "30d" });

const buildSession = (driver: any) => ({
  _id: driver._id,
  name: driver.name,
  mobile: driver.mobile,
  email: driver.email,
  profileImage: driver.profileImage,
  dateOfBirth: driver.dateOfBirth,
  status: driver.status,
  isVerified: driver.isVerified,
  approvalStatus: driver.approvalStatus,
  rejectionReason: driver.rejectionReason,
  onboardingStep: driver.onboardingStep,
  vehicles: driver.vehicles,
  documents: driver.documents,
  owner: driver.owner,
  bank: driver.bank,
  address: driver.address,
});

export const sendOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile, deviceId, deviceType } = req.body;

    if (!mobile) throw new AppError("Mobile number is required", 400);

    const mobileRegex = /^[6-9]\d{9}$/;
    if (!mobileRegex.test(mobile))
      throw new AppError("Invalid mobile number format", 400);

    let driver = await Driver.findOne({ mobile, isDeleted: false });

    if (driver) {
      if (driver.status === "blocked") {
        throw new AppError(
          "Your account has been blocked. Please contact support.",
          403,
        );
      }

      if (driver.otpAttempts >= MAX_OTP_ATTEMPTS) {
        const lastAttemptTime = driver.otpExpiry
          ? new Date(driver.otpExpiry).getTime()
          : 0;
        const cooldown = 15 * 60 * 1000;
        if (Date.now() - lastAttemptTime < cooldown) {
          throw new AppError(
            "Too many OTP requests. Please try again after 15 minutes.",
            429,
          );
        }
        driver.otpAttempts = 0;
      }
    } else {
      driver = new Driver({
        mobile,
        status: "active",
        isVerified: false,
        approvalStatus: "pending",
        onboardingStep: "personal",
        deviceInfo: { deviceId, deviceType },
      });
    }

    const otp = generateOTP();
    driver.otp = otp;
    driver.otpExpiry = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);
    driver.otpAttempts = (driver.otpAttempts || 0) + 1;

    if (deviceId || deviceType) {
      driver.deviceInfo = {
        ...driver.deviceInfo,
        deviceId: deviceId || driver.deviceInfo?.deviceId,
        deviceType: deviceType || driver.deviceInfo?.deviceType,
      };
    }

    await driver.save();

    console.log(`Driver OTP for ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: "OTP sent successfully",
      data: {
        mobile,
        expiresIn: OTP_EXPIRY_SECONDS,
        isNewDriver: !driver.isVerified,
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile, otp, fcmToken, deviceId, deviceType } = req.body;
    if (!mobile || !otp)
      throw new AppError("Mobile number and OTP are required", 400);

    const driver = await Driver.findOne({ mobile, isDeleted: false });
    if (!driver) throw new AppError("Driver not found. Request OTP first.", 404);

    if (driver.status === "blocked") {
      throw new AppError(
        "Your account has been blocked. Please contact support.",
        403,
      );
    }

    if (!driver.otp || !driver.otpExpiry)
      throw new AppError("No OTP found. Please request a new OTP.", 400);

    if (new Date() > driver.otpExpiry)
      throw new AppError("OTP has expired. Please request a new OTP.", 400);

    if (driver.otp !== otp)
      throw new AppError("Invalid OTP. Please try again.", 400);

    driver.otp = undefined;
    driver.otpExpiry = undefined;
    driver.otpAttempts = 0;
    driver.isVerified = true;

    driver.deviceInfo = {
      ...driver.deviceInfo,
      deviceId: deviceId || driver.deviceInfo?.deviceId,
      deviceType: deviceType || driver.deviceInfo?.deviceType,
      fcmToken: fcmToken || driver.deviceInfo?.fcmToken,
      lastLoginAt: new Date(),
    };

    await driver.save();

    const token = generateDriverToken(driver._id.toString());

    res.json({
      success: true,
      message: "Verification successful",
      data: { token, driver: buildSession(driver) },
    });
  } catch (error) {
    next(error);
  }
};

export const resendOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mobile } = req.body;
    if (!mobile) throw new AppError("Mobile number is required", 400);

    const driver = await Driver.findOne({ mobile, isDeleted: false });
    if (!driver)
      throw new AppError("Driver not found. Request OTP first.", 404);

    if (driver.status === "blocked")
      throw new AppError(
        "Your account has been blocked. Please contact support.",
        403,
      );

    const otp = generateOTP();
    driver.otp = otp;
    driver.otpExpiry = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);
    driver.otpAttempts = (driver.otpAttempts || 0) + 1;
    await driver.save();

    console.log(`Driver OTP (resend) for ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: "OTP resent successfully",
      data: {
        mobile,
        expiresIn: OTP_EXPIRY_SECONDS,
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driver = await Driver.findById(req.driver!.id);
    if (!driver) throw new AppError("Driver not found", 404);
    res.json({ success: true, data: driver });
  } catch (error) {
    next(error);
  }
};

export const updateProfileImage = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Three accepted body shapes (we use whichever the client sends):
    //   1. multipart with field `image` (multer-s3 → req.file.location)
    //   2. `{ image: "data:image/jpeg;base64,..." }` — what the mobile app
    //      uses because multipart PUTs from RN's bridge are unreliable
    //   3. `{ url: "https://..." }` — legacy/internal-tools shape
    const uploadedUrl = (req.file as any)?.location as string | undefined;
    const body = (req.body || {}) as { image?: string; url?: string };

    let url = (uploadedUrl || "").trim();

    if (!url && typeof body.image === "string" && body.image.startsWith("data:")) {
      // data URI: data:<mime>;base64,<payload>
      const match = body.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        throw new AppError("Invalid base64 image payload", 400);
      }
      const mime = match[1];
      const payload = match[2];
      if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime)) {
        throw new AppError("Only JPEG, PNG, and WebP images are supported", 400);
      }
      const buffer = Buffer.from(payload, "base64");
      if (buffer.length === 0) {
        throw new AppError("Empty image payload", 400);
      }
      if (buffer.length > 5 * 1024 * 1024) {
        throw new AppError("Image must be 5 MB or smaller", 400);
      }
      url = await uploadBufferToS3(buffer, "driver/profile", mime);
    }

    if (!url && typeof body.url === "string") {
      url = body.url.trim();
    }

    if (!url) throw new AppError("Image file or url is required", 400);

    const driver = await Driver.findById(req.driver!.id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted) throw new AppError("Account has been deleted", 401);

    driver.profileImage = url;
    await driver.save();

    res.json({ success: true, data: buildSession(driver) });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: DriverRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const driver = await Driver.findById(req.driver!.id);
    if (driver) {
      driver.deviceInfo = { ...driver.deviceInfo, fcmToken: undefined };
      await driver.save();
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};
