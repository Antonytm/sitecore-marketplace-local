/**
 * Path-rewrite table: cloud-side API path -> local endpoint.
 *
 * Every `xmc.*` operation reaches the host as a `host.request` whose `path` is
 * the generated client's dummy baseUrl path plus the operation path. The
 * prefixes below were read off the `baseUrl` in each
 * `packages/xmc/src/client-<name>/client.gen.ts` in @sitecore-marketplace-sdk/xmc
 * 0.4.2:
 *
 *   client-authoring        https://example.com/v1/authoring      + /graphql
 *   client-content          https://example.com/content/api       + /graphql/v1
 *   client-content-transfer https://example.com/authoring/transfer
 *   client-xmapp/pages/sites https://example.com/authoring        + /api/v1/...
 *   client-agent            https://example.com/stream/ai-agent-api/
 *   client-search           https://example.com/search
 *
 * In the real product an Envoy gateway resolves these against the tenant. Here
 * the gateway resolves them against `https://xmcloudcm.localhost`.
 *
 * `verified: false` means the local target is an educated guess that has NOT
 * been confirmed against a running container. Run `pnpm --filter @sml/gateway
 * probe` once Docker is up; it rewrites this table's confidence for you.
 */

export type RouteStatus = 'local' | 'degraded' | 'unavailable';

export interface RouteRule {
  /** SDK namespace(s) that produce this path, for reporting. */
  namespaces: string[];
  /** Longest-prefix match against `GenericRequestData.path`. */
  prefix: string;
  /** Local base to substitute for the prefix. `null` when unavailable. */
  target: string | null;
  status: RouteStatus;
  verified: boolean;
  note: string;
}

export const DEFAULT_LOCAL_CM = 'https://xmcloudcm.localhost';

export function buildRouteTable(cm: string = DEFAULT_LOCAL_CM): RouteRule[] {
  return [
    {
      namespaces: ['xmc.authoring'],
      prefix: '/v1/authoring/graphql',
      target: `${cm}/sitecore/api/authoring/graphql/v1`,
      status: 'local',
      verified: false,
      note:
        'Authoring & Management GraphQL. Present on the local CM. Mutations need ' +
        'Sitecore_GraphQL_Authoring_Mutations enabled in docker-compose.override.yml.',
    },
    {
      namespaces: ['xmc.preview', 'xmc.live'],
      prefix: '/content/api/graphql/v1',
      target: `${cm}/sitecore/api/graph/edge`,
      status: 'degraded',
      verified: false,
      note:
        'Preview AND Delivery both land here. `xmc.preview.graphql` and ' +
        '`xmc.live.graphql` are literally the same generated function with the ' +
        'same path (see client-content/sdk.gen.ts), so the host cannot tell them ' +
        'apart from the path alone - the discriminator is the `sitecoreContextId` ' +
        'query param, which the real host resolves to a live or preview Edge ' +
        'environment. Locally there is no Experience Edge and no publish ' +
        'pipeline, so both resolve to the CM preview endpoint. Content therefore ' +
        'reads as published when it is not: never test publishing behaviour here. ' +
        'The gateway logs a warning when the live context ID is requested.',
    },
    {
      namespaces: ['xmc.xmapp', 'xmc.sites', 'xmc.pages'],
      prefix: '/authoring/api/v1',
      target: `${cm}/api/v1`,
      status: 'local',
      verified: false,
      note:
        'XM Apps API (sites, pages, collections, languages, jobs). BIGGEST ' +
        'UNKNOWN: confirm the local CM container serves these. Pages in ' +
        'local-XM mode calls them, which is the reason to expect they exist.',
    },
    {
      namespaces: ['xmc.contentTransfer'],
      prefix: '/authoring/transfer',
      target: `${cm}/authoring/transfer`,
      status: 'degraded',
      verified: false,
      note: 'Content transfer targets cloud environments; unlikely to be meaningful locally.',
    },
    {
      namespaces: ['xmc.search'],
      prefix: '/search',
      target: null,
      status: 'unavailable',
      verified: true,
      note: 'Sitecore Search is a separate SaaS product. No local equivalent.',
    },
    {
      namespaces: ['xmc.agent', 'ai'],
      prefix: '/stream/ai-agent-api',
      target: null,
      status: 'unavailable',
      verified: true,
      note: 'AI agent streaming API is cloud-only. No local equivalent.',
    },
  ];
}

/** Longest-prefix match against the path, ignoring the query string. */
export function matchRoute(path: string, table: RouteRule[]): RouteRule | undefined {
  const bare = path.split('?')[0];
  let best: RouteRule | undefined;
  for (const rule of table) {
    if (bare === rule.prefix || bare.startsWith(rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best;
}

/** Rewrites a cloud path onto its local target, preserving the query string. */
export function rewrite(path: string, rule: RouteRule): string | null {
  if (!rule.target) return null;
  return rule.target + path.slice(rule.prefix.length);
}
