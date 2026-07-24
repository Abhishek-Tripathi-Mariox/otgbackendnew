import crypto from "crypto";
import axios from "axios";
import { isServiceReady } from "./configService";

/**
 * Generates a real random 6-digit OTP (replaces the old hardcoded "123456").
 */
export const generateOtp = (): string =>
  crypto.randomInt(100000, 999999).toString();

/**
 * Sends an OTP via MSG91. Follows the same resilience pattern as mailer.ts:
 * if SMS isn't configured/enabled, logs the OTP (preserving today's dev
 * console.log convenience) and returns false; if the MSG91 API call itself
 * fails, logs the error and returns false. Never throws — callers (login/
 * resend-otp flows) must always succeed regardless of SMS delivery.
 */
export const sendOtpSms = async (
  mobile: string,
  otp: string,
): Promise<boolean> => {
  const creds = await isServiceReady("sms", ["apiKey", "senderId", "templateId"]);

  if (!creds) {
    // Only echo the actual OTP to the console in dev — logging real OTPs in
    // production (e.g. if SMS gets misconfigured after going live) would be
    // a credential-in-logs exposure if logs ever ship anywhere less trusted
    // than the app itself.
    if (process.env.NODE_ENV === "development") {
      console.warn(`[otpService] SMS not configured — OTP for ${mobile}: ${otp}`);
    } else {
      console.warn(`[otpService] SMS not configured — OTP for ${mobile} was not sent.`);
    }
    return false;
  }

  try {
    const fullMobile = mobile.startsWith("91") ? mobile : `91${mobile}`;

    await axios.post(
      "https://control.msg91.com/api/v5/otp",
      {
        mobile: fullMobile,
        otp,
        template_id: creds.templateId,
        sender: creds.senderId,
      },
      {
        headers: { authkey: creds.apiKey },
        timeout: 10000,
      },
    );

    return true;
  } catch (error) {
    console.error(`[otpService] Failed to send OTP via MSG91 to ${mobile}:`, error);
    return false;
  }
};
