import axios from "axios";
import { isServiceReady } from "./configService";

const FCM_LEGACY_ENDPOINT = "https://fcm.googleapis.com/fcm/send";
const MAX_TOKENS_PER_BATCH = 1000; // FCM legacy API's registration_ids limit

export interface PushResult {
  sent: number;
  failed: number;
}

/**
 * Sends a push notification to a list of FCM device tokens using the legacy
 * FCM HTTP API (keyed by the admin-configured Firebase "Server Key"). Chosen
 * over the modern firebase-admin/HTTP-v1 SDK because the existing admin
 * Config schema only stores a serverKey, not a full service-account JSON —
 * this ships with zero schema/UI changes. Never throws: if push isn't
 * configured, or the FCM call fails, returns {sent:0, failed:0/tokens.length}
 * so the caller (notification.controller.ts) always completes successfully.
 */
export const sendPush = async (
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<PushResult> => {
  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) return { sent: 0, failed: 0 };

  const creds = await isServiceReady("firebase", ["serverKey"]);
  if (!creds) {
    console.warn("[pushService] Firebase not configured — skipping push send.");
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < validTokens.length; i += MAX_TOKENS_PER_BATCH) {
    const chunk = validTokens.slice(i, i + MAX_TOKENS_PER_BATCH);
    try {
      const res = await axios.post(
        FCM_LEGACY_ENDPOINT,
        {
          registration_ids: chunk,
          notification: { title, body },
          data,
        },
        {
          headers: {
            Authorization: `key=${creds.serverKey}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        },
      );
      sent += res.data?.success || 0;
      failed += res.data?.failure || 0;
    } catch (error) {
      console.error("[pushService] FCM send failed for a batch:", error);
      failed += chunk.length;
    }
  }

  return { sent, failed };
};
