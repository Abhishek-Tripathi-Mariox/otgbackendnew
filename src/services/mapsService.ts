import axios from "axios";
import { isServiceReady } from "./configService";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const GOOGLE_PLACES_TEXT_SEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GOOGLE_GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";

// Both search + reverse results are shaped like Nominatim's own API response
// (same {place_id, display_name, lat, lon} / {display_name, address:{...}}
// fields the 4 frontends already parse) — Google results are translated into
// this exact shape so no frontend consumer needs to change how it reads the
// response, only which URL it calls.
export interface GeocodeSearchResult {
  place_id: string | number;
  display_name: string;
  lat: string;
  lon: string;
}

export interface GeocodeAddress {
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
}

export interface ReverseGeocodeResult {
  display_name: string;
  address: GeocodeAddress;
}

const getGoogleApiKey = async (): Promise<string | null> => {
  const creds = await isServiceReady("google-api", []);
  if (!creds) return null;
  return creds.placesApiKey || creds.mapsApiKey || creds.apiKey || null;
};

const googleComponentsToAddress = (
  components: Array<{ long_name: string; types: string[] }>,
): GeocodeAddress => {
  const find = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name;

  return {
    road: find("route"),
    neighbourhood: find("neighborhood"),
    suburb: find("sublocality") || find("sublocality_level_1"),
    city: find("locality"),
    county: find("administrative_area_level_2"),
    state: find("administrative_area_level_1"),
    postcode: find("postal_code"),
  };
};

const searchViaNominatim = async (query: string): Promise<GeocodeSearchResult[]> => {
  const res = await axios.get(NOMINATIM_SEARCH, {
    params: { format: "jsonv2", addressdetails: 1, limit: 6, countrycodes: "in", q: query },
    headers: { "User-Agent": "OTGBackend/1.0 (support@otg.app)" },
    timeout: 8000,
  });
  return Array.isArray(res.data) ? res.data : [];
};

const reverseViaNominatim = async (
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult> => {
  const res = await axios.get(NOMINATIM_REVERSE, {
    params: { format: "json", lat, lon, addressdetails: 1 },
    headers: { "User-Agent": "OTGBackend/1.0 (support@otg.app)" },
    timeout: 8000,
  });
  return {
    display_name: res.data?.display_name || "",
    address: res.data?.address || {},
  };
};

/**
 * Address search (autocomplete). Uses Google Places if configured/enabled,
 * otherwise falls back to the free OpenStreetMap Nominatim search — same
 * behavior as today, just proxied server-side instead of called directly
 * from each app. Never throws: any upstream failure returns an empty array.
 */
export const searchAddress = async (query: string): Promise<GeocodeSearchResult[]> => {
  const googleKey = await getGoogleApiKey();

  if (googleKey) {
    try {
      const res = await axios.get(GOOGLE_PLACES_TEXT_SEARCH, {
        params: { query: `${query}, India`, key: googleKey },
        timeout: 8000,
      });
      // Google returns HTTP 200 even for failures (bad key, billing not
      // enabled, quota exceeded, API not enabled for this key) — the real
      // outcome is in the body's `status` field, not the HTTP status.
      // "ZERO_RESULTS" is a legitimate empty result, not a failure.
      if (res.data?.status !== "OK" && res.data?.status !== "ZERO_RESULTS") {
        console.error(
          `[mapsService] Google Places search rejected (status: ${res.data?.status}):`,
          res.data?.error_message || res.data,
        );
      } else {
        const results = res.data?.results || [];
        return results.map((r: any) => ({
          place_id: r.place_id,
          display_name: r.formatted_address || r.name,
          lat: String(r.geometry?.location?.lat ?? ""),
          lon: String(r.geometry?.location?.lng ?? ""),
        }));
      }
    } catch (error) {
      console.error("[mapsService] Google Places search failed, falling back to OSM:", error);
    }
  }

  try {
    return await searchViaNominatim(query);
  } catch (error) {
    console.error("[mapsService] Nominatim search failed:", error);
    return [];
  }
};

/**
 * Reverse geocode (lat/lon -> address). Uses Google Geocoding if configured,
 * otherwise Nominatim. Never throws.
 */
export const reverseGeocode = async (
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult> => {
  const googleKey = await getGoogleApiKey();

  if (googleKey) {
    try {
      const res = await axios.get(GOOGLE_GEOCODE, {
        params: { latlng: `${lat},${lon}`, key: googleKey },
        timeout: 8000,
      });
      // Same body-level `status` check as searchAddress above — HTTP 200
      // does not mean Google actually geocoded anything.
      if (res.data?.status !== "OK") {
        console.error(
          `[mapsService] Google reverse geocode rejected (status: ${res.data?.status}):`,
          res.data?.error_message || res.data,
        );
      } else {
        const result = res.data?.results?.[0];
        if (result) {
          return {
            display_name: result.formatted_address || "",
            address: googleComponentsToAddress(result.address_components || []),
          };
        }
      }
    } catch (error) {
      console.error("[mapsService] Google reverse geocode failed, falling back to OSM:", error);
    }
  }

  try {
    return await reverseViaNominatim(lat, lon);
  } catch (error) {
    console.error("[mapsService] Nominatim reverse geocode failed:", error);
    return { display_name: "", address: {} };
  }
};
