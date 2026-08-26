import type {
  GenericRequestData,
  GenericResponseData,
  WireRequest,
  WireResponse,
} from '@sml/protocol';

/** Vite proxies this to the gateway process, keeping the browser same-origin. */
const GATEWAY_PATH = '/__gateway/request';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface GatewayResult {
  response: GenericResponseData;
  route: WireResponse['route'];
}

/**
 * Fulfils `host.request` by handing it to the local gateway.
 *
 * The client has already stripped the origin - `path` is all we get, and the
 * host is what decides where it lands. Doing the actual call server-side keeps
 * local CM credentials out of the browser and sidesteps the CM's CORS policy.
 */
export async function forwardToGateway(req: GenericRequestData): Promise<GatewayResult> {
  const wire: WireRequest = {
    path: req.path,
    method: req.method ?? 'GET',
    headers: req.headers ?? {},
    bodyBase64: req.body && req.body.byteLength > 0 ? toBase64(req.body) : null,
    requiresAuth: req.requiresAuth,
    contextId: req.contextId,
  };

  const res = await fetch(GATEWAY_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wire),
  });

  if (!res.ok && res.status >= 500) {
    const text = await res.text();
    throw new Error(`Local gateway is unreachable or failed (${res.status}): ${text}`);
  }

  const payload = (await res.json()) as WireResponse;

  return {
    response: {
      status: payload.status,
      statusText: payload.statusText,
      headers: payload.headers,
      body: fromBase64(payload.bodyBase64),
    },
    route: payload.route,
  };
}
