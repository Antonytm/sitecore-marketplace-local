import { loadConfig } from './config.ts';
import { createForwarder } from './forward.ts';
import type { WireRequest } from '@sml/protocol';

/**
 * Answers the question the route table cannot answer on its own: which of these
 * endpoints does a local CM container actually serve?
 *
 * Run it once the containers are up:
 *   pnpm --filter @sml/gateway probe
 *
 * Read the result by status class, not by success:
 *   200/400  the endpoint exists and is reachable
 *   401/403  the endpoint exists; the token is missing or insufficient
 *   404      the endpoint is NOT served locally - that namespace is a stub
 *   ECONN    the container stack is not running
 */

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
  if (status === 502) return 'UNREACHABLE  gateway could not connect';
  if (status === 401 || status === 403) return 'PRESENT      exists, needs a valid token';
  if (status >= 200 && status < 500) return 'PRESENT      reachable';
  return `UNKNOWN      status ${status}`;
}

const config = loadConfig();
const forward = createForwarder(config);

console.log(`probing ${config.cm}`);
console.log(`token: ${config.token ? config.tokenSource : 'NONE (expect 401s)'}\n`);

for (const probe of CASES) {
  const wire: WireRequest = {
    path: probe.path,
    method: probe.method,
    headers: probe.body ? { 'content-type': 'application/json' } : {},
    bodyBase64: probe.body ? Buffer.from(probe.body, 'utf8').toString('base64') : null,
    requiresAuth: true,
  };

  const result = await forward(wire);
  const label = probe.namespace.padEnd(26);
  console.log(`${label} ${String(result.status).padEnd(4)} ${verdict(result.status)}`);
  if (result.status >= 200 && result.status < 300) {
    const body = Buffer.from(result.bodyBase64, 'base64').toString('utf8');
    console.log(`${' '.repeat(27)} ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
}

console.log('\nUpdate `verified` and `status` in packages/protocol/src/routes.ts from these results.');
