import nodemailer, { Transporter } from "nodemailer";

/**
 * Lightweight email service.
 *
 * Configuration is read from environment variables so it works with any SMTP
 * provider (Gmail, AWS SES SMTP, SendGrid SMTP, Mailtrap, etc.):
 *
 *   SMTP_HOST       e.g. email-smtp.ap-south-1.amazonaws.com / smtp.gmail.com
 *   SMTP_PORT       e.g. 587 (STARTTLS) or 465 (SSL)
 *   SMTP_SECURE     "true" for port 465, otherwise "false"
 *   SMTP_USER       SMTP username
 *   SMTP_PASS       SMTP password / app password
 *   SMTP_FROM       From header, e.g. "OTG <no-reply@otg.com>"
 *   APP_DOWNLOAD_URL  (optional) link used in seller-approval mail CTA
 *
 * If SMTP is not configured the service degrades gracefully: it logs a warning
 * and resolves without throwing, so business flows (e.g. seller approval) are
 * never blocked by mail delivery.
 */

let cachedTransporter: Transporter | null = null;
let warnedMissingConfig = false;

const isMailConfigured = (): boolean =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = (): Transporter | null => {
  if (!isMailConfigured()) {
    if (!warnedMissingConfig) {
      console.warn(
        "[mailer] SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing). Emails will be skipped.",
      );
      warnedMissingConfig = true;
    }
    return null;
  }

  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return cachedTransporter;
};

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends an email. Never throws — on failure it logs and resolves false, so
 * callers can fire-and-forget without wrapping every call in try/catch.
 */
export const sendMail = async (options: SendMailOptions): Promise<boolean> => {
  try {
    const transporter = getTransporter();
    if (!transporter) return false;
    if (!options.to) {
      console.warn("[mailer] No recipient address — skipping email.");
      return false;
    }

    const from =
      process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@otg.com";

    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    return true;
  } catch (error) {
    console.error("[mailer] Failed to send email:", error);
    return false;
  }
};

export default { sendMail };
