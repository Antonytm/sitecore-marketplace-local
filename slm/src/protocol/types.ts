import type { ExtensionPoint } from './actions.ts';

/**
 * Payload of a `host.request`, as built by `ClientSDK._fetch`.
 *
 * Note `path` is origin-stripped: `_fetch` takes `url.pathname + url.search +
 * url.hash` and discards the host. The generated xmc clients all use a dummy
 * `https://example.com/...` baseUrl for exactly this reason, so the *host*
 * decides which backend a call lands on. That is the hook this project uses to
 * redirect every XM Cloud API call at a local instance.
 */
export interface GenericRequestData {
  contextId?: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer;
  requiresAuth: boolean;
}

/** Shape `ClientSDK._fetch` expects back; it feeds straight into `new Response()`. */
export interface GenericResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

/** A locally registered app - our stand-in for a Cloud Portal app record. */
export interface LocalAppRecord {
  id: string;
  name: string;
  /** Origin the app is served from, e.g. `http://localhost:3000`. */
  origin: string;
  iconUrl?: string;
  /** Route path per extension point, e.g. `{ standalone: '/standalone-extension' }`. */
  routes: Partial<Record<ExtensionPoint, string>>;
}

export interface LocalAppsConfig {
  /** Origin the host shell itself is served from; apps must pass this as `origin`. */
  hostOrigin: string;
  apps: LocalAppRecord[];
}
