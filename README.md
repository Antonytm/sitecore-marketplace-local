# sitecore-marketplace-local

A **local Sitecore Marketplace host**. Runs Marketplace apps on localhost, at every extension
point, against a local SitecoreAI (XM Cloud) Docker instance instead of a cloud tenant.

**Setting up? Follow [`docs/setup.md`](docs/setup.md)** — containers, app, Authoring API, in order.

Read [`docs/findings.md`](docs/findings.md) for what is and isn't possible and why. The short
version: the Marketplace SDK is open source and ships both sides of its postMessage protocol,
so the host can be re-hosted; the cloud-only backends behind it cannot.

## Quick start

```bash
git submodule update --init      # the apps under apps/
pnpm install
pnpm test                        # verify the protocol contract against the real SDK
pnpm dev                         # host on :5173
```

Then start an app in a second terminal — `pnpm dev:starter` or `pnpm dev:sje`, after the
one-time setup in [The apps](#the-apps).

Open <http://localhost:5173>, pick an app and an extension point.

No Docker is needed for any of the above — context queries are served from fixtures. Docker is
only required for real data (see [Running SitecoreAI locally](#running-sitecoreai-locally)).

## Layout

| Path | What |
|---|---|
| `slm/` | **S**itecore **L**ocal **M**arketplace: the host shell, the protocol surface, the route table, fixtures and the contract test |
| `slm/apps.json` | Stands in for Developer Studio app records |
| `slm/src/node/` | Runs under Node, not the browser: token lookup from `sitecore/.sitecore/user.json`, and the endpoint probe |
| `sitecore/` | Everything for the local instance: container stack, Next.js rendering host, Sitecore CLI config, serialized items |
| `apps/marketplace-starter` | Submodule — Sitecore's starter, all five extension points, `:3000` |
| `apps/SJE` | Submodule — Sitecore JavaScript Extensions, standalone + fullscreen, `:3002` |

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

For `apps/marketplace-starter` this change ships as a patch, because the submodule should stay
clean — see [`docs/setup.md`](docs/setup.md) step 2.

## The apps

Two Marketplace apps ship with this repo as git submodules, already registered in
`slm/apps.json`:

| App | What | Port | Start |
|---|---|---|---|
| **Marketplace Starter** | Sitecore's official starter. Demonstrates all five extension points, one route each. | `3000` | `pnpm dev:starter` |
| **Sitecore JavaScript Extensions** (SJE) | A web-based alternative to Sitecore PowerShell Extensions — a Monaco editor that runs scripts against ~127 helper methods over the Sitecore APIs. [Hackathon 2026 entry](https://exdst.com/posts/20260310-sitecore-hackathon-2026/). Standalone and fullscreen only. | `3002` | `pnpm dev:sje` |

Different ports on purpose: both default to `:3000`, so SJE is moved to `:3002` and
`slm/apps.json` registers it there.

### One-time setup

Neither app passes `origin` to `ClientSDK.init`, so neither will hand-shake with a localhost
host until it is patched — see [The one change your app needs](#the-one-change-your-app-needs).
Both are submodules, so the change ships as a patch file rather than a committed edit, keeping
the submodules clean:

```bash
git submodule update --init

cd apps/marketplace-starter
git apply ../marketplace-starter.patch
echo "NEXT_PUBLIC_MP_HOST_ORIGIN=http://localhost:5173" > .env.local
npm install

cd ../SJE
git apply ../SJE.patch
cd src/ide
echo "NEXT_PUBLIC_MP_HOST_ORIGIN=http://localhost:5173" > .env.local
npm install
```

Note SJE's app lives in `src/ide/`, not at its submodule root — install and run it from there.
`git apply`, though, runs from the submodule root, because the patch paths are relative to it.

If an app sits at **`waiting for handshake…`** forever, this setup is almost always why. Open
devtools on the *iframe* and look for `[client SDK] Invalid message origin`.

## Registering an app

Add your own to `slm/apps.json`:

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

## Running SitecoreAI locally

`sitecore/` holds the container stack from Sitecore's
[xmcloud-starter-js](https://github.com/Sitecore/xmcloud-starter-js): CM, SQL Server, Solr,
Traefik and a Next.js rendering host.

### Prerequisites

| | |
|---|---|
| OS | Windows 10/11 Pro or Enterprise, with the Hyper-V and Containers features on |
| Docker Desktop | **Windows containers** mode (tray icon → *Switch to Windows containers*) |
| Licence | a Sitecore `license.xml` |
| .NET SDK | for the Sitecore CLI — `up.ps1` runs `dotnet tool restore` itself |
| Disk | ~40 GB free for images |

### Once: initialise

In an **elevated** PowerShell — it writes hosts-file entries and installs an mkcert root CA:

```powershell
.\sitecore\scripts\init.ps1 -InitEnv -LicenseXmlPath C:\license\license.xml -AdminPassword "<choose one>"
```

This creates `sitecore/.env` from `.env.example` (the real file is gitignored), fills in
generated secrets, and issues certificates for `xmcloudcm.localhost` and
`*.xmc-starter-js.localhost`.

### Every time: start and stop

```powershell
pnpm sitecore:up     # build, start, log in, rebuild indexes — the first run is long
pnpm sitecore:logs   # follow the CM container log
pnpm sitecore:down
```

`sitecore:up` opens a browser for device authorisation — approve it. The login leaves a token in
`sitecore/.sitecore/user.json`, where the host's dev server finds it without any configuration.
The local CM federates auth to Auth0, so the cloud-issued token works against it.

Content survives `sitecore:down`; it lives in `sitecore/docker/data/`.

### Addresses

| What | URL |
|---|---|
| CM / Content Editor | <https://xmcloudcm.localhost/sitecore/> — `admin` / `SITECORE_ADMIN_PASSWORD` from `sitecore/.env` |
| Authoring GraphQL IDE | <https://xmcloudcm.localhost/sitecore/api/authoring/graphql/ide/> — add header `Authorization: Bearer <accessToken from sitecore/.sitecore/user.json>` |
| Rendering host | <https://nextjs.xmc-starter-js.localhost> — errors until a site exists in the local CM |
| Traefik dashboard | <http://localhost:8079> |
| Solr | <http://localhost:8984> |
| SQL Server | `localhost,14330` — `sa` / `SQL_SA_PASSWORD` |

### Point the host at it

```bash
pnpm dev               # Vite banner: token yes (...\sitecore\.sitecore\user.json [default])
pnpm probe:endpoints   # xmc.authoring should come back PRESENT
```

Read the probe by status class: `404` means absent, `401`/`403` present but unauthorised,
`200`/`400` present. Update `verified` and `status` in `slm/src/protocol/routes.ts` from
the results.

Environment variables, read by `pnpm dev` and `pnpm probe:endpoints`:

| Variable | Default | Purpose |
|---|---|---|
| `SML_LOCAL_CM` | `https://xmcloudcm.localhost` | Local CM base URL |
| `ACCESS_TOKEN` | — | Bearer token for authenticated calls, overrides any `user.json` |
| `SML_SITECORE_USER_JSON` | `<repo>/sitecore/.sitecore/user.json` | Where to read a token from instead |
| `SML_INSECURE_TLS` | `1` | Probe only: accept the container's self-signed dev cert |

## Caveats

- **`xmc.live` is a lie locally.** It shares a path with `xmc.preview` and there is no local
  Experience Edge, so both resolve to the CM preview endpoint. Content reads as published when
  it is not. Do not test publishing here.
- **`xmc.search` and `xmc.agent` return 501.** No local equivalent exists.
- **The host page holds the token, like Cloud Portal.** `host.request` is fulfilled by a
  `fetch` from the host page to the CM with `Authorization: Bearer`; the app iframe cannot read
  it. Only the dev server injects it — `vite build` does not. The CM allows the host's origin via
  `sitecore/docker/deploy/platform/App_Config/Include/zzz/LocalMarketplace.CORS.config`,
  which the CM's dev entrypoint syncs into the webroot.
- **The context fixtures are reconstructions.** `slm/src/protocol/fixtures.ts` is built from the
  SDK's TypeScript interfaces, most of which end in `[key: string]: any`. The real host almost
  certainly sends more.
- **The SDK is pre-1.0.** The origin allowlist, the `:query` suffix convention and the
  `host.request` payload are unversioned internals. Versions are pinned exactly; `pnpm test`
  fails loudly if any of them move.
