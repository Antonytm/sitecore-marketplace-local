# sitecore-marketplace-local

A **local Sitecore Marketplace host**. Runs Marketplace apps on localhost, at every extension
point, against a local SitecoreAI/XM Cloud Docker instance instead of a cloud tenant.

**Setting up? Follow [`docs/setup.md`](docs/setup.md)** — containers, app, Authoring API, in order.

Read [`docs/findings.md`](docs/findings.md) for what is and isn't possible and why. The short
version: the Marketplace SDK is open source and ships both sides of its postMessage protocol,
so the host can be re-hosted; the cloud-only backends behind it cannot.

## Quick start

```bash
pnpm install
pnpm test          # verify the protocol contract against the real SDK
pnpm dev           # host on :5173, gateway on :8787
pnpm dev:probe     # protocol probe on :3001 (optional)
```

Open <http://localhost:5173>, pick an app and an extension point.

No Docker is needed for any of the above — context queries are served from fixtures. Docker is
only required for real data (see [Connecting a local instance](#connecting-a-local-instance)).

## The one change your app needs

```ts
ClientSDK.init({
  target: window.parent,
  origin: 'http://localhost:5173',  // <- this line
  modules: [XMC],
})
```

Without `origin`, the SDK only trusts `*.sitecorecloud.io` and will ignore this host. With it,
the allowlist is skipped. Drop the line and the same build works in Cloud Portal unchanged.

## Layout

| Path | What |
|---|---|
| `apps/host` | The host shell: iframes an app, answers the protocol, inspects every message |
| `apps/probe` | Capture harness — runs the full protocol surface and downloads a transcript |
| `packages/protocol` | Action registry, route table, fixtures, and the contract test |
| `packages/gateway` | Local stand-in for Sitecore's Envoy proxy: path rewrite + auth |
| `config/local-apps.json` | Stands in for Developer Studio app records |

## Registering an app

Add it to `config/local-apps.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "origin": "http://localhost:3000",
  "routes": { "standalone": "/standalone-extension" }
}
```

The `routes` keys are the SDK's extension points: `standalone`, `xmc:fullscreen`,
`xmc:pages:contextpanel`, `xmc:pages:customfield`, `xmc:dashboardblocks`.

## Connecting a local instance

1. Start the XM Cloud container stack so `https://xmcloudcm.localhost` responds.
2. Find out what it actually serves — this settles the open question in the findings:

   ```bash
   pnpm probe:endpoints
   ```

   `404` means absent, `401`/`403` means present but unauthorised, `200`/`400` means present.
   Update `verified` and `status` in `packages/protocol/src/routes.ts` from the results.

3. Give the gateway a token. `up.ps1` already leaves one in `.sitecore/user.json` — the local
   CM federates auth to Auth0, so the cloud-issued token works against it — and the gateway
   picks the endpoint whose host matches your CM. Override only if you need to:

   ```bash
   SML_LOCAL_TOKEN=<bearer>
   ```

Gateway environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SML_LOCAL_CM` | `https://xmcloudcm.localhost` | Local CM base URL |
| `SML_LOCAL_TOKEN` | — | Bearer token for authenticated calls |
| `SML_SITECORE_USER_JSON` | `./.sitecore/user.json` | Where to read a token from instead |
| `SML_GATEWAY_PORT` | `8787` | |
| `SML_INSECURE_TLS` | `1` | Accept the container's self-signed dev cert |

## Capturing ground truth from Cloud Portal

The fixtures in `packages/protocol/src/fixtures.ts` are reconstructed from TypeScript
interfaces, most of which end in `[key: string]: any`. The real host almost certainly sends
more. To capture what it actually sends:

1. Register `apps/probe` in Developer Studio against `http://localhost:3001`, at every
   extension point.
2. `pnpm dev:probe`, open it in Cloud Portal, hit **run suite**, then **download transcript**.
3. Commit the transcript (it is redacted on the way out) to `packages/protocol/fixtures/` and
   fold the real shapes into `fixtures.ts`.

The same probe runs against this host with `?hostOrigin=http://localhost:5173`. Comparing the
two transcripts is how you tell whether the local host is faithful.

## Caveats

- **`xmc.live` is a lie locally.** It shares a path with `xmc.preview` and there is no local
  Experience Edge, so both resolve to the CM preview endpoint. Content reads as published when
  it is not. Do not test publishing here.
- **`xmc.search` and `xmc.agent` return 501.** No local equivalent exists.
- **The SDK is pre-1.0.** The origin allowlist, the `:query` suffix convention and the
  `host.request` payload are unversioned internals. Versions are pinned exactly; `pnpm test`
  fails loudly if any of them move.
