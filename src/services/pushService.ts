import crypto from "crypto";
import admin from "firebase-admin";
import { isServiceReady } from "./configService";

// FCM's sendEachForMulticast batch limit.
const MAX_TOKENS_PER_BATCH = 500;

export interface PushResult {
  sent: number;
  failed: number;
}

let cachedApp: admin.app.App | null = null;
let cachedCredentialHash: string | null = null;

/**
 * Lazily initializes (and re-initializes if the stored service-account JSON
 * changes) a named firebase-admin app — using the modern HTTP v1 API via the
 * SDK, not the legacy fcm.googleapis.com/fcm/send endpoint Google has
 * deprecated for new Firebase projects. Returns null if not configured.
 */
const getMessagingApp = async (): Promise<admin.app.App | null> => {
  const creds = await isServiceReady("firebase", ["serviceAccountJson"]);
  if (!creds) return null;

  let serviceAccount: admin.ServiceAccount;
  try {
    serviceAccount = JSON.parse(creds.serviceAccountJson);
  } catch (error) {
    console.error(
      "[pushService] Firebase serviceAccountJson is not valid JSON — check the value saved in admin config.",
    );
    return null;
  }

  const hash = crypto
    .createHash("sha256")
    .update(creds.serviceAccountJson)
    .digest("hex");

  if (cachedApp && cachedCredentialHash === hash) return cachedApp;

  // Re-initializing with the same app name replaces the previous app —
  // delete it first to avoid firebase-admin's "app already exists" error.
  if (cachedApp) {
    try {
      await cachedApp.delete();
    } catch {
      // ignore — best-effort cleanup
    }
  }

  try {
    cachedApp = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      "otg-push",
    );
    cachedCredentialHash = hash;
    return cachedApp;
  } catch (error) {
    console.error("[pushService] Failed to initialize firebase-admin:", error);
    cachedApp = null;
    cachedCredentialHash = null;
    return null;
  }
};

/**
 * Sends a push notification to a list of FCM device tokens via the
 * firebase-admin SDK. Never throws: if push isn't configured, or the send
 * fails, returns {sent:0, failed:0/tokens.length} so the caller
 * (notification.controller.ts) always completes successfully.
 */
export const sendPush = async (
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<PushResult> => {
  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) return { sent: 0, failed: 0 };

  const app = await getMessagingApp();
  if (!app) {
    console.warn("[pushService] Firebase not configured — skipping push send.");
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < validTokens.length; i += MAX_TOKENS_PER_BATCH) {
    const chunk = validTokens.slice(i, i + MAX_TOKENS_PER_BATCH);
    try {
      const res = await app.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data,
      });
      sent += res.successCount;
      failed += res.failureCount;
      res.responses.forEach((r, idx) => {
        if (!r.success) {
          console.error(
            `[pushService] FCM send failed for token ...${chunk[idx].slice(-8)}:`,
            r.error?.message,
          );
        }
      });
    } catch (error) {
      console.error("[pushService] FCM send failed for a batch:", error);
      failed += chunk.length;
    }
  }

  return { sent, failed };
};
