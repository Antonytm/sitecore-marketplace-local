import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Agent } from 'node:https';
import type { WireRequest, WireResponse } from '@sml/protocol';
import { buildRouteTable, matchRoute, rewrite, LOCAL_IDS } from '@sml/protocol';
import type { GatewayConfig } from './config.ts';

/**
 * Headers the SDK marks as required on every Marketplace call. Preserved so the
 * local CM sees the same request shape the cloud gateway would forward.
 * (`DEFAULT_HEADERS` in @sitecore-marketplace-sdk/shared.)
 */
const MARKETPLACE_HEADERS = {
  'sc-resource': 'marketplace',
  'sc-marketplace-auth': 'interactive/v1',
};

/** Hop-by-hop headers that must not be copied onto the outbound request. */
const STRIP = new Set(['host', 'connection', 'content-length', 'origin', 'referer']);

export function createForwarder(config: GatewayConfig) {
  const table = buildRouteTable(config.cm);

  // The container stack terminates TLS with a self-signed dev certificate.
  // Scoped to this agent rather than flipping NODE_TLS_REJECT_UNAUTHORIZED,
  // which would disable verification for the whole process.
  const agent = new Agent({ rejectUnauthorized: !config.insecureTls, keepAlive: true });

  return async function forward(wire: WireRequest): Promise<WireResponse> {
    const rule = matchRoute(wire.path, table);

    if (!rule) {
      return refuse(501, `No route for "${wire.path}".`, {
        matched: null,
        target: null,
        note: 'Unmapped path. Add a rule in packages/protocol/src/routes.ts.',
      });
    }

    const target = rewrite(wire.path, rule);
    if (!target) {
      return refuse(
        501,
        `${rule.namespaces.join(', ')} is not available against a local instance. ${rule.note}`,
        { matched: rule.prefix, target: null, note: rule.note },
      );
    }

    const note = buildNote(wire, rule.note, rule.status);

    const headers: Record<string, string> = { ...MARKETPLACE_HEADERS };
    for (const [key, value] of Object.entries(wire.headers ?? {})) {
      if (!STRIP.has(key.toLowerCase())) headers[key] = value;
    }
    if (wire.requiresAuth && config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }

    const body = wire.bodyBase64 ? Buffer.from(wire.bodyBase64, 'base64') : undefined;
    if (body) headers['content-length'] = String(body.byteLength);

    try {
      const res = await send(target, wire.method, headers, body, agent);
      return {
        ...res,
        route: { matched: rule.prefix, target, note },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return refuse(502, `Could not reach ${target}: ${message}`, {
        matched: rule.prefix,
        target,
        note: 'Is the local container stack running? Check https://xmcloudcm.localhost in a browser.',
      });
    }
  };
}

/**
 * `xmc.live` and `xmc.preview` are indistinguishable by path, so the only clue
 * that an app wanted published content is the context ID it asks for.
 */
function buildNote(wire: WireRequest, ruleNote: string, status: string): string | undefined {
  if (wire.path.includes(LOCAL_IDS.liveContextId)) {
    return 'Requested the LIVE context, but there is no local Experience Edge - served from the CM preview endpoint instead. Results will not reflect publishing state.';
  }
  return status === 'local' ? undefined : ruleNote;
}

function refuse(status: number, message: string, route: WireResponse['route']): WireResponse {
  const payload = JSON.stringify({
    errors: [{ message }],
    localGateway: true,
  });
  return {
    status,
    statusText: status === 501 ? 'Not Implemented' : 'Bad Gateway',
    headers: { 'content-type': 'application/json' },
    bodyBase64: Buffer.from(payload, 'utf8').toString('base64'),
    route,
  };
}

function send(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  agent: Agent,
): Promise<Omit<WireResponse, 'route'>> {
  const parsed = new URL(url);
  const doRequest = parsed.protocol === 'http:' ? httpRequest : httpsRequest;

  return new Promise((resolve, reject) => {
    const req = doRequest(
      url,
      { method, headers, agent: parsed.protocol === 'https:' ? agent : undefined },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            flat[key] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: flat,
            bodyBase64: Buffer.concat(chunks).toString('base64'),
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timed out after 30s')));
    if (body) req.write(body);
    req.end();
  });
}
