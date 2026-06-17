/**
 * HTML email templates for OTG.
 *
 * Templates are self-contained (inline styles) so they render consistently
 * across email clients.
 */

const BRAND_YELLOW = "#FDE200";
const BRAND_DARK = "#404040";

const layout = (inner: string): string => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:${BRAND_DARK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:${BRAND_YELLOW};padding:28px 32px;text-align:center;">
                <span style="font-size:26px;font-weight:bold;letter-spacing:1px;color:${BRAND_DARK};">OTG</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${inner}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center;font-size:12px;color:#999;">
                <p style="margin:0 0 4px;">You're receiving this email because you applied to become a seller on OTG.</p>
                <p style="margin:0;">&copy; ${new Date().getFullYear()} OTG. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const button = (label: string, url: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0;">
    <tr>
      <td align="center" style="border-radius:10px;background:${BRAND_YELLOW};">
        <a href="${url}" target="_blank"
           style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:bold;color:${BRAND_DARK};text-decoration:none;border-radius:10px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;

export interface SellerApprovedTemplateData {
  name?: string;
  businessName?: string;
  appDownloadUrl?: string;
}

export const sellerApprovedEmail = (
  data: SellerApprovedTemplateData,
): { subject: string; html: string; text: string } => {
  const name = data.name?.trim() || "there";
  const business = data.businessName?.trim();
  const appUrl =
    data.appDownloadUrl ||
    process.env.APP_DOWNLOAD_URL ||
    process.env.VENDOR_APP_DOWNLOAD_URL ||
    "https://play.google.com/store";

  const businessLine = business
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
         Your business <strong>${business}</strong> has been approved to sell on OTG. 🎉
       </p>`
    : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
         Your request to become a seller on OTG has been approved. 🎉
       </p>`;

  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:22px;color:${BRAND_DARK};">Welcome aboard, ${name}!</h1>
    ${businessLine}
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      You can now start receiving orders and managing your inventory. To get started,
      download the OTG Seller app and log in with your registered mobile number.
    </p>
    ${button("Download the Seller App", appUrl)}
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#777;">
      If the button above doesn't work, copy and paste this link into your browser:<br/>
      <a href="${appUrl}" style="color:#1a73e8;word-break:break-all;">${appUrl}</a>
    </p>
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;">
      Need help? Just reply to this email and our team will assist you.
    </p>
  `);

  const text = `Welcome aboard, ${name}!

${business ? `Your business "${business}" has been approved to sell on OTG.` : "Your request to become a seller on OTG has been approved."}

You can now start receiving orders and managing your inventory. Download the OTG Seller app and log in with your registered mobile number:

${appUrl}

Need help? Just reply to this email and our team will assist you.

— Team OTG`;

  return {
    subject: "Your OTG Seller account is approved 🎉",
    html,
    text,
  };
};

export default { sellerApprovedEmail };
