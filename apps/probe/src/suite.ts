import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

export interface SuiteResult {
  name: string;
  kind: 'query' | 'mutation' | 'subscribe';
  ok: boolean;
  detail: unknown;
  ms: number;
}

const INTROSPECT = { body: { query: '{ __typename }' } };

/**
 * One representative call per protocol surface, so a single run produces a
 * complete transcript.
 *
 * The `host.*` / `pages.*` / `application.*` keys go straight to the host. The
 * `xmc.*` keys do not: they execute in the client and reach the host as
 * `host.request` with an origin-stripped path. Both shapes matter - the first
 * tells us what context the host serves, the second tells us which backend
 * paths a local gateway has to satisfy.
 */
const QUERIES = [
  'application.context',
  'host.user',
  'host.state',
  'host.route',
  'pages.context',
  'site.context',
] as const;

const MUTATIONS: Array<{ key: string; params?: unknown }> = [
  { key: 'pages.reloadCanvas' },

  // xmc namespaces. Every one of these is a `host.request` underneath.
  { key: 'xmc.authoring.graphql', params: INTROSPECT },
  { key: 'xmc.preview.graphql', params: INTROSPECT },
  { key: 'xmc.live.graphql', params: INTROSPECT },
  { key: 'xmc.xmapp.listLanguages' },
  { key: 'xmc.sites.listCollections' },
  { key: 'xmc.search.getConfigs' },
  { key: 'xmc.agent.componentsListComponents' },

  // Not covered: xmc.contentTransfer - every operation needs an existing
  // transfer id, so there is no side-effect-free probe. Use the gateway's
  // `pnpm --filter @sml/gateway probe` for raw reachability of that prefix.
];

const SUBSCRIPTIONS = ['pages.content.layoutUpdated', 'pages.content.fieldsUpdated'] as const;

export async function runSuite(
  client: ClientSDK,
  onResult: (result: SuiteResult) => void,
): Promise<void> {
  for (const key of QUERIES) {
    await time(key, 'query', onResult, async () => {
      const res = await client.query(key as never);
      if (res.error) throw res.error;
      return res.data;
    });
  }

  for (const { key, params } of MUTATIONS) {
    await time(key, 'mutation', onResult, () =>
      client.mutate(key as never, (params ? { params } : undefined) as never),
    );
  }

  for (const key of SUBSCRIPTIONS) {
    await time(key, 'subscribe', onResult, async () => {
      const unsubscribe = await client.subscribe(key as never, {
        onData: () => undefined,
      });
      // Registration is what we are testing; the host decides when to push.
      return typeof unsubscribe === 'function' ? 'subscribed' : unsubscribe;
    });
  }
}

async function time(
  name: string,
  kind: SuiteResult['kind'],
  onResult: (r: SuiteResult) => void,
  run: () => Promise<unknown>,
): Promise<void> {
  const started = performance.now();
  try {
    const detail = await run();
    onResult({ name, kind, ok: true, detail, ms: Math.round(performance.now() - started) });
  } catch (err) {
    onResult({
      name,
      kind,
      ok: false,
      detail: err instanceof Error ? err.message : err,
      ms: Math.round(performance.now() - started),
    });
  }
}
