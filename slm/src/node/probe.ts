import { loadConfig } from './config.ts';
import { buildRouteTable, matchRoute, rewrite } from '../protocol/index.ts';

/**
 * Answers the question the route table cannot answer on its own: which of these
 * endpoints does a local CM container actually serve?
 *
 * Run it once the containers are up:
 *   pnpm probe:endpoints
 *
 * Read the result by status class, not by success:
 *   200/400  the endpoint exists and is reachable
 *   401/403  the endpoint exists; the token is missing or insufficient
 *   404      the endpoint is NOT served locally - that namespace is a stub
 *   ECONN    the container stack is not running
 *
 * This is the Node-side mirror of what `src/cm-client.ts` does in the browser.
 * It exists because the browser cannot tell a CORS rejection from a stopped
 * container, and this can.
 */

/**
 * Headers the SDK marks as required on every Marketplace call, so the CM sees
 * the same request shape a real app would produce.
 * (`DEFAULT_HEADERS` in @sitecore-marketplace-sdk/shared.)
 */
const MARKETPLACE_HEADERS = {
  'sc-resource': 'marketplace',
  'sc-marketplace-auth': 'interactive/v1',
};

const GRAPHQL_INTROSPECTION = JSON.stringify({ query: '{ __typename }' });

interface ProbeCase {
  namespace: string;
  path: string;
  method: string;
  body?: string;
}

const CASES: ProbeCase[] = [
  {
    namespace: 'xmc.authoring',
    path: '/v1/authoring/graphql',
    method: 'POST',
    body: GRAPHQL_INTROSPECTION,
  },
  {
    namespace: 'xmc.preview / xmc.live',
    path: '/content/api/graphql/v1',
    method: 'POST',
    body: GRAPHQL_INTROSPECTION,
  },
  { namespace: 'xmc.xmapp (languages)', path: '/authoring/api/v1/languages', method: 'GET' },
  { namespace: 'xmc.sites (collections)', path: '/authoring/api/v1/collections', method: 'GET' },
  { namespace: 'xmc.pages (search)', path: '/authoring/api/v1/pages/search', method: 'GET' },
  { namespace: 'xmc.contentTransfer', path: '/authoring/transfer', method: 'GET' },
  { namespace: 'xmc.search', path: '/search/', method: 'GET' },
  { namespace: 'xmc.agent', path: '/stream/ai-agent-api/', method: 'GET' },
];

function verdict(status: number): string {
  if (status === 0) return 'UNREACHABLE  container stack down?';
  if (status === 404) return 'ABSENT       not served locally -> stub this namespace';
  if (status === 501) return 'REFUSED      no local equivalent (by design)';
  if (status === 401 || status === 403) return 'PRESENT      exists, needs a valid token';
  if (status >= 200 && status < 500) return 'PRESENT      reachable';
  return `UNKNOWN      status ${status}`;
}

const config = loadConfig();
const table = buildRouteTable(config.cm);

// The container stack terminates TLS with a self-signed dev certificate. This is
// a one-shot CLI, so relaxing verification for the whole process is contained;
// set SML_INSECURE_TLS=0 to keep it strict.
if (config.insecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log(`probing ${config.cm}`);
console.log(`token: ${config.token ? config.tokenSource : 'NONE (expect 401s)'}\n`);

for (const probe of CASES) {
  const label = probe.namespace.padEnd(26);

  // No rule, or a rule with no local target, is a refusal by design rather
  // than a fact about the CM - report it without making a request.
  const rule = matchRoute(probe.path, table);
  const target = rule ? rewrite(probe.path, rule) : null;
  if (!target) {
    console.log(`${label} ${'501'.padEnd(4)} ${verdict(501)}`);
    continue;
  }

  const headers: Record<string, string> = { ...MARKETPLACE_HEADERS };
  if (probe.body) headers['content-type'] = 'application/json';
  if (config.token) headers.authorization = `Bearer ${config.token}`;

  try {
    const res = await fetch(target, { method: probe.method, headers, body: probe.body });
    console.log(`${label} ${String(res.status).padEnd(4)} ${verdict(res.status)}`);
    if (res.ok) {
      const body = await res.text();
      console.log(`${' '.repeat(27)} ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`${label} ${'-'.padEnd(4)} ${verdict(0)}  ${message}`);
  }
}

console.log('\nUpdate `verified` and `status` in slm/src/protocol/routes.ts from these results.');
