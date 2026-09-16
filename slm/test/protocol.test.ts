/**
 * Verifies the claims this project is built on, against the real SDK.
 *
 * Run: pnpm test
 *
 * 1. A localhost host origin is accepted, because passing `targetOrigin` skips
 *    the `AllowedOrigins` allowlist. This is the single fact that makes a local
 *    Marketplace host possible without patching the SDK.
 * 2. An unknown host origin IS rejected when `targetOrigin` is omitted - so the
 *    escape hatch is deliberate, not a hole we imagined.
 * 3. Query keys reach the host as `<key>:query`, mutations as `<key>:mutation`.
 * 4. `host.request` round-trips a body both ways.
 * 5. Host events reach a subscribing client under the bare key.
 */

import assert from 'node:assert/strict';
import { installWindow, makeTarget, reset } from './harness.ts';

const HOST_ORIGIN = 'http://localhost:5173';
const APP_ORIGIN = 'http://localhost:3000';

// The SDK logs every envelope at debug/info level. Useful in a browser,
// overwhelming here - the assertions are the output that matters.
if (!process.env.SML_VERBOSE) {
  console.debug = () => {};
  console.info = () => {};
  // Both bridges share one listener list (see harness.ts), so each one sees
  // and correctly rejects its own echoed traffic as INVALID_ORIGIN. That is
  // the origin check working, not a failure.
  console.warn = () => {};
  console.error = () => {};
  console.log = ((original) => (...args: unknown[]) => {
    if (typeof args[0] === 'string' && /^(INFO|DEBUG|WARN):/.test(args[0])) return;
    original(...args);
  })(console.log.bind(console)) as typeof console.log;
}

installWindow(HOST_ORIGIN);

const { CoreSDK } = await import('@sitecore-marketplace-sdk/core');
const { ClientSDK } = await import('@sitecore-marketplace-sdk/client');

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : err}`);
  }
}

function startHost(handlers: Record<string, (payload: any) => unknown>) {
  const host = new CoreSDK({
    selfOrigin: HOST_ORIGIN,
    targetOrigin: APP_ORIGIN,
    timeout: 5000,
  });
  host.initialize({
    type: 'host',
    selfOrigin: HOST_ORIGIN,
    targetOrigin: APP_ORIGIN,
    version: '1',
  });
  for (const [action, handler] of Object.entries(handlers)) {
    host.onRequest(action, handler);
  }
  host.setTarget(makeTarget(HOST_ORIGIN));
  return host;
}

console.log('marketplace protocol contract\n');

const seen: string[] = [];

await test('localhost host origin completes the handshake', async () => {
  reset();
  const host = startHost({
    'host.user:query': () => {
      seen.push('host.user:query');
      return { id: 'u1', name: 'Local', email: 'local@localhost' };
    },
  });

  const client = await ClientSDK.init({
    target: makeTarget(APP_ORIGIN),
    origin: HOST_ORIGIN,
  });

  const result = await client.query('host.user');
  assert.equal(result.error, undefined, `query errored: ${result.error?.message}`);
  assert.equal(result.data?.name, 'Local');
  host.destroy();
});

await test('query keys arrive suffixed with :query', async () => {
  assert.deepEqual(seen, ['host.user:query']);
});

await test('mutation keys arrive suffixed with :mutation', async () => {
  reset();
  let got: string | null = null;
  const host = startHost({
    'pages.reloadCanvas:mutation': () => {
      got = 'pages.reloadCanvas:mutation';
      return undefined;
    },
  });

  const client = await ClientSDK.init({ target: makeTarget(APP_ORIGIN), origin: HOST_ORIGIN });
  await client.mutate('pages.reloadCanvas');
  assert.equal(got, 'pages.reloadCanvas:mutation');
  host.destroy();
});

await test('host.request round-trips a body', async () => {
  reset();
  let receivedPath: string | null = null;
  const host = startHost({
    'host.request': (payload: any) => {
      receivedPath = payload.path;
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(JSON.stringify({ data: { __typename: 'Query' } })).buffer,
      };
    },
  });

  const client = await ClientSDK.init({ target: makeTarget(APP_ORIGIN), origin: HOST_ORIGIN });
  const response = await (client as any)._fetch(
    new Request('https://example.com/v1/authoring/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ __typename }' }),
      headers: { 'content-type': 'application/json' },
    }),
  );

  // The origin is discarded by the client; only the path reaches the host.
  // That is what lets a local gateway redirect these calls at a local CM.
  assert.equal(receivedPath, '/v1/authoring/graphql');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { __typename: 'Query' } });
  host.destroy();
});

await test('host events reach a subscribing client under the bare key', async () => {
  reset();
  const host = startHost({
    'pages.context:query': () => ({ pageInfo: { name: 'Home' } }),
  });

  const client = await ClientSDK.init({ target: makeTarget(APP_ORIGIN), origin: HOST_ORIGIN });

  const received: unknown[] = [];
  await client.query('pages.context', {
    subscribe: true,
    onSuccess: (data) => received.push(data),
  });

  host.emit('pages.context', { pageInfo: { name: 'About' } });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(
    received.some((d: any) => d?.pageInfo?.name === 'About'),
    `subscription never saw the emitted event; got ${JSON.stringify(received)}`,
  );
  host.destroy();
});

await test('an un-allowlisted origin is rejected when `origin` is omitted', async () => {
  reset();
  const host = startHost({ 'host.user:query': () => ({ id: 'u1' }) });

  // No `origin`: the SDK falls back to AllowedOrigins, which does not include
  // localhost, so the handshake response is ignored and init times out.
  await assert.rejects(
    ClientSDK.init({ target: makeTarget(APP_ORIGIN) }),
    /timed out|Handshake/i,
    'expected the allowlist to reject a localhost host',
  );
  host.destroy();
});

console.log(`\n${failures === 0 ? 'all contracts hold' : `${failures} failing`}`);
process.exit(failures === 0 ? 0 : 1);
