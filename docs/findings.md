# Can Sitecore Marketplace run against a local SitecoreAI instance?

**Yes — mostly.** You can run Marketplace apps entirely on localhost, at every extension
point, against a local SitecoreAI (XM Cloud) Docker instance. It does not require patching or
forking the SDK. What you cannot reproduce locally is the set of cloud-only backends the
Marketplace host proxies to, and the Marketplace registry itself.

Everything below was established by reading the published SDK source and verifying it against
the real packages (`pnpm test`), not from documentation.

---

## 1. What "the Marketplace" actually is

Three things wear that name, and separating them is what makes the question answerable:

| Layer | What it is | Local? |
|---|---|---|
| **The registry** | Developer Studio in Cloud Portal: app records, install, approval, org permissions, public listing | ❌ cloud-only, no analogue |
| **The host** | The page that iframes your app and answers its requests | ✅ **reproducible** |
| **The app** | Your React/Next code | ✅ already runs anywhere |

Sitecore documents the third as "local development" — you register an app whose deployment URL
is `http://localhost:3000` and it loads in Cloud Portal. But the *data* still comes from a
cloud tenant. That is a local app, not a local Marketplace.

The interesting layer is the host. And the host is not proprietary.

## 2. Three facts that make a local host possible

### 2.1 The SDK ships both sides of the protocol

`@sitecore-marketplace-sdk/core` is Apache-2.0 and its `PostMessageBridge` / `HandshakeManager`
implement `type: 'host'` in full — `onRequest`, `emit`, `setTarget`, handshake buffering. Cloud
Portal is one consumer of that code. `slm` in this repo is a second one. No wire format
was reimplemented here; the shipped bridge is driven directly.

### 2.2 The origin allowlist has a supported escape hatch

The client SDK checks the host origin against a hardcoded list:

```ts
// packages/core/src/allowed-origins.ts
export const AllowedOrigins = ['sitecore-staging.cloud', 'sitecorecloud.app', 'sitecorecloud.io'];
```

But `post-message.ts` only consults it when `targetOrigin` is empty:

```ts
if (this.sdkType === 'client' && message.type === 'handshake' && this.isNullOrEmpty(this.config.targetOrigin)) {
  // ...check AllowedOrigins
} else {
  isValidOrigin = eventOriginUrl.origin === expectedOriginUrl.origin;
}
```

`ClientSDK.init({ origin })` sets `targetOrigin`. So **one line in the app** unlocks a
localhost host:

```ts
ClientSDK.init({ target: window.parent, origin: 'http://localhost:5173', modules: [XMC] })
```

Both halves are covered by `pnpm test`: with `origin`, the handshake completes; without it, a
localhost host is rejected. The escape hatch is deliberate, not an oversight we exploited.

*If an app genuinely cannot be rebuilt*, the fallback is to serve the host from a hosts-file
entry under `*.sitecorecloud.io` with a locally-trusted certificate — the allowlist matches on
hostname suffix.

### 2.3 Every API call is host-routed, and the client discards the origin

This is the load-bearing one. `ClientSDK._fetch`:

```ts
const url = new URL(input.url);
const path = url.pathname + url.search + url.hash;   // origin thrown away
return this.coreSdk.request('host.request', { path, method, headers, body, requiresAuth: true });
```

Every generated `xmc` client uses a dummy `https://example.com/...` base URL for exactly this
reason. The **host** decides which backend a call lands on and attaches the token. Redirecting
all XM Cloud API traffic at a local CM is therefore one request handler plus a path-rewrite
table — not an interception hack.

## 3. The complete host protocol

Registered via `onRequest`. Note the suffixes: `ClientSDK.resolveOperation` appends `:query` or
`:mutation` to any key that is not a registered SDK module namespace.

| Action | Notes |
|---|---|
| `application.context:query` | app id, installation, org, `resourceAccess[].context.live/preview` |
| `host.user:query` | `{ id, name, email }` |
| `host.state:query` | shape depends on app type; `null` for `portal` |
| `host.route:query` | current host route |
| `pages.context:query` | selected site + page |
| `site.context:query` | selected site |
| `pages.reloadCanvas:mutation` | no local canvas — no-op |
| `pages.context:mutation` | app pushes context back |
| `host.request` | **no suffix** — the generic HTTP proxy |
| `host.logout`, `host.openProfile`, `host.navigateTo.externalUrl`, `host.setNavbarItems` | direct calls |

Events the host emits — subscriptions listen on the **bare key**, no suffix: `host.state`,
`pages.context`, `host.route`, `pages.content.layoutUpdated`, `pages.content.fieldsUpdated`.

The bridge also falls back from `foo:query` to a handler registered as `foo`, and supports a
`'*'` catch-all. `slm` registers the catch-all so an unrecognised action fails loudly
instead of silently.

## 4. Gap matrix — what survives the move to local

Derived from the `baseUrl` of each generated client in `@sitecore-marketplace-sdk/xmc@0.4.2`.
The route table lives in `slm/src/protocol/routes.ts`.

| Namespace | Path the client sends | Local target | Verdict |
|---|---|---|---|
| `xmc.authoring` | `/v1/authoring/graphql` | `/sitecore/api/authoring/graphql/v1` | ✅ **works** — the main authoring surface |
| `xmc.preview` | `/content/api/graphql/v1` | `/sitecore/api/graph/edge` | ✅ works; schema close but not identical to Edge |
| `xmc.live` | *same path as preview* | same | ⚠️ **degraded** — see below |
| `xmc.xmapp` / `sites` / `pages` | `/authoring/api/v1/...` | `/api/v1/...` on CM | ❌ **absent** — the local API does not serve these; probed, `404` |
| `xmc.contentTransfer` | `/authoring/transfer/...` | — | ❌ absent — probed, `404`; targets cloud environments anyway |
| `xmc.search` | `/search/...` | none | ❌ separate SaaS product |
| `xmc.agent`, `@sitecore-marketplace-sdk/ai` | `/stream/ai-agent-api/...` | none | ❌ cloud-only |

Also unavailable: Deploy/Environments APIs, the publish pipeline, and anything requiring a real
Edge environment.

### The live/preview collapse

`xmc.live.graphql` and `xmc.preview.graphql` are **literally the same generated function with
the same path** (`client-content/sdk.gen.ts`). The only discriminator is the `sitecoreContextId`
query parameter, which the real host resolves to a live or preview Edge environment.

Locally there is no Experience Edge and no CM→CD publish pipeline, so both collapse onto the
CM preview endpoint. **Content will read as published when it is not.** The host logs a
warning when the live context ID is requested. Never validate publishing behaviour here.

## 5. What about Sitecore's own supported route?

Sitecore supports pointing **cloud Pages** at a local XM instance: set the localStorage key
`Sitecore.Pages.LocalXmCloudUrl` to `https://xmcloudcm.localhost/`, and on the CM set
`SITECORE_Pages_Client_Host`, `SITECORE_Pages_CORS_Allowed_Origins` and `SITECORE_GRAPHQL_CORS`.

This is genuinely useful and worth having — but it does **not** answer the original question.
It redirects *Pages'* own calls to the local instance. A Marketplace app running inside that
Pages session still sends `host.request` to the cloud host, which still resolves it against the
cloud tenant. You get local page context with cloud data — a split brain that is arguably more
confusing than either pure setup.

The approaches are complementary, not alternatives:

| | App code | Page context | XM Cloud data | Registry |
|---|---|---|---|---|
| Documented "local development" | local | cloud | cloud | cloud |
| Pages → local XM | cloud | **local** | cloud | cloud |
| **This repo** | local | **local** | **local** | local file |

