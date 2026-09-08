import crypto from "crypto";
import axios from "axios";
import { isServiceReady } from "./configService";

/**
 * Generates a real random 6-digit OTP (replaces the old hardcoded "123456").
 */
export const generateOtp = (): string =>
  crypto.randomInt(100000, 999999).toString();

// Fixed QA/testing bypass code — deliberately gated on NODE_ENV so it can
// NEVER work in production, regardless of how this env var ends up set.
const TEST_OTP = "123456";

/**
 * Checks a submitted OTP against the stored one — accepting the fixed test
 * code as an alternative ONLY outside production, so QA can log in without
 * reading the real OTP from server logs/dev response echo every time.
 */
export const isValidOtp = (submitted: string, stored: string): boolean => {
  if (submitted === stored) return true;
  return process.env.NODE_ENV !== "production" && submitted === TEST_OTP;
};

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
  // senderId is intentionally not required here — with the /v5/flow API the
  // sender is baked into the DLT template registration itself, not passed
  // as a request param (kept in the admin config only for reference/labeling).
  const creds = await isServiceReady("sms", ["apiKey", "templateId"]);

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
    // MSG91 expects mobile as concatenated digits only (e.g. "919999999999").
    const cc = "91";
    const num = mobile.replace(/\D/g, "").replace(/^91/, "");
    const fullMobile = `${cc}${num}`;
    const templateId = creds.templateId.trim();
    const apiKey = creds.apiKey.trim();

    // Use the Flow/Send-SMS API (/v5/flow), not the dedicated /v5/otp
    // endpoint. MSG91's /v5/otp endpoint requires the template to be
    // registered under MSG91's separate "OTP" template category; a normal
    // DLT-verified SMS template (the common case) only works via /v5/flow,
    // with the OTP passed positionally as VAR1. Posting a /v5/otp-category
    // template_id to /v5/otp can return `type:"success"` (MSG91 accepts the
    // API call) while the carrier silently drops the message, since the
    // template isn't actually linked for that flow — sender ID is baked
    // into the template registration itself, not passed as a param here.
    const res = await axios.post(
      "https://control.msg91.com/api/v5/flow",
      {
        template_id: templateId,
        short_url: "0",
        // MSG91 ignores recipient keys that don't match the DLT-approved
        // template's actual variable name — sending every common naming
        // convention at once (VAR1/var1/VAR2/OTP/var/otp) costs nothing and
        // maximizes the odds of matching whatever this specific template was
        // registered with, without needing to know the exact name in advance.
        recipients: [
          {
            mobiles: fullMobile,
            VAR1: otp,
            var1: otp,
            VAR2: otp,
            OTP: otp,
            var: otp,
            otp,
          },
        ],
      },
      {
        headers: {
          accept: "application/json",
          authkey: apiKey,
          "content-type": "application/json",
        },
        timeout: 10000,
      },
    );

    // MSG91 returns HTTP 200 even for some logical failures — the real
    // outcome is in the body's `type` field.
    if (res.data?.type !== "success") {
      console.error(`[otpService] MSG91 rejected OTP send to ${mobile}:`, res.data);
      return false;
    }

    console.log(
      `[otpService] MSG91 accepted OTP for ${mobile} (request_id: ${res.data?.request_id}). ` +
        `If it doesn't arrive, check this request_id in the MSG91 dashboard's delivery report — ` +
        `a "success" API response only means MSG91 queued it, not that the carrier delivered it.`,
    );
    return true;
  } catch (error: any) {
    console.error(
      `[otpService] Failed to send OTP via MSG91 to ${mobile}:`,
      error?.response?.data || error?.message || error,
    );
    return false;
  }
};
