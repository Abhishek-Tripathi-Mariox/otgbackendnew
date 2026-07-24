import Config from "../models/Config.model";

export type ConfigServiceName = "google-api" | "firebase" | "razorpay" | "sms";

/**
 * Reads an admin-configured service's decrypted fields as a flat key/value
 * map. Returns null if the service was never configured or is toggled off —
 * callers should treat null as "not configured" and degrade gracefully
 * rather than throwing, so business flows never break when a service isn't
 * set up yet.
 */
export const getServiceConfig = async (
  service: ConfigServiceName,
): Promise<Record<string, string> | null> => {
  const config = await Config.findOne({ service, isActive: true });
  if (!config) return null;

  const fields = (config as any).getDecryptedFields();

  return fields.reduce(
    (acc: Record<string, string>, field: { key: string; value: string }) => {
      acc[field.key] = field.value;
      return acc;
    },
    {} as Record<string, string>,
  );
};

/**
 * Like getServiceConfig, but also returns null if any of the required keys
 * is missing/blank — the single check every integration service should call
 * before attempting to use a third-party API.
 */
export const isServiceReady = async (
  service: ConfigServiceName,
  requiredKeys: string[],
): Promise<Record<string, string> | null> => {
  const values = await getServiceConfig(service);
  if (!values) return null;

  const hasAllRequired = requiredKeys.every((key) =>
    Boolean(values[key] && values[key].trim()),
  );

  return hasAllRequired ? values : null;
};
