/**
 * Compatibility re-export — sole transport is lib/apiClient.
 */
export {
  API_KEY_NOT_CONFIGURED_MSG,
  getApiFootballBaseUrl,
  getApiFootballKey,
  isApiFootballKeyError,
  isApiFootballConfigured,
  apiFootballGet,
  apiClientGet,
  sleep,
  logApiFootballHealth,
  clearApiClientCache,
} from "@/lib/apiClient";

export type {
  ApiClientResult,
  ApiCacheKind,
  ApiFootballResponse,
} from "@/lib/apiClient";
