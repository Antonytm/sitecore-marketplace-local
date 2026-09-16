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
 * the host resolves them against `https://xmcloudcm.localhost`.
 *
 * `verified: false` means the local target is an educated guess that has NOT
 * been confirmed against a running container. Run `pnpm probe:endpoints` once
 * Docker is up and update this table from what it reports.
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
      verified: true,
      note:
        'Authoring & Management GraphQL. Present on the local CM (probed: 200). Mutations need ' +
        'Sitecore_GraphQL_Authoring_Mutations enabled in docker-compose.override.yml.',
    },
    {
      namespaces: ['xmc.preview', 'xmc.live'],
      prefix: '/content/api/graphql/v1',
      target: `${cm}/sitecore/api/graph/edge`,
      status: 'degraded',
      verified: true,
      note:
        'Preview AND Delivery both land here. `xmc.preview.graphql` and ' +
        '`xmc.live.graphql` are literally the same generated function with the ' +
        'same path (see client-content/sdk.gen.ts), so the host cannot tell them ' +
        'apart from the path alone - the discriminator is the `sitecoreContextId` ' +
        'query param, which the real host resolves to a live or preview Edge ' +
        'environment. Locally there is no Experience Edge and no publish ' +
        'pipeline, so both resolve to the CM preview endpoint. Content therefore ' +
        'reads as published when it is not: never test publishing behaviour here. ' +
        'The host logs a warning when the live context ID is requested.',
    },
    {
      namespaces: ['xmc.xmapp', 'xmc.sites', 'xmc.pages'],
      prefix: '/authoring/api/v1',
      target: null,
      status: 'unavailable',
      verified: true,
      note:
        'XM Apps API (sites, pages, collections, languages, jobs). Probed against ' +
        'a running stack: 404 on every path, using the same token that got 200 ' +
        'from authoring GraphQL - so absent, not unauthorised. Refused here so an ' +
        'app gets a clean 501 instead of a puzzling 404 from the CM.',
    },
    {
      namespaces: ['xmc.contentTransfer'],
      prefix: '/authoring/transfer',
      target: null,
      status: 'unavailable',
      verified: true,
      note:
        'Content transfer targets cloud environments, and is not served locally ' +
        'either (probed: 404).',
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
