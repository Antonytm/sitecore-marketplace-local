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
pnpm dev           # host on :5173
pnpm dev:probe     # protocol probe on :3001 (optional)
```

Open <http://localhost:5173>, pick an app and an extension point.

No Docker is needed for any of the above — context queries are served from fixtures. Docker is
only required for real data (see [Running SitecoreAI locally](#running-sitecoreai-locally)).

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
| `packages/gateway` | Node side: token lookup from `.sitecore/user.json`, and the endpoint probe |
| `config/local-apps.json` | Stands in for Developer Studio app records |
| `local-containers/` | SitecoreAI container stack — CM, SQL, Solr, Traefik, Next.js rendering host — and its scripts |
| `examples/basic-nextjs` | The rendering host app the stack mounts |
| `authoring/items` | Serialized rendering-host item that `up.ps1` pushes |
| `sitecore.json`, `.config/` | Sitecore CLI config used by `up.ps1` |
| `third-party/` | Licence for the files vendored from Sitecore's xmcloud-starter-js |

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

## Running SitecoreAI locally

`local-containers/` is the container stack from Sitecore's
[xmcloud-starter-js](https://github.com/Sitecore/xmcloud-starter-js) (Apache-2.0, see
`third-party/`): CM, SQL Server, Solr, Traefik and a Next.js rendering host.

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
.\local-containers\scripts\init.ps1 -InitEnv -LicenseXmlPath C:\license\license.xml -AdminPassword "<choose one>"
```

This creates `local-containers/.env` from `.env.example` (the real file is gitignored), fills in
generated secrets, and issues certificates for `xmcloudcm.localhost` and
`*.xmc-starter-js.localhost`.

### Every time: start and stop

```powershell
pnpm sitecore:up     # build, start, log in, rebuild indexes — the first run is long
pnpm sitecore:logs   # follow the CM container log
pnpm sitecore:down
```

`sitecore:up` opens a browser for device authorisation — approve it. The login leaves a token in
this repo's `.sitecore/user.json`, where the host's dev server finds it without any configuration. The
local CM federates auth to Auth0, so the cloud-issued token works against it.

Content survives `sitecore:down`; it lives in `local-containers/docker/data/`.

### Addresses

| What | URL |
|---|---|
| CM / Content Editor | <https://xmcloudcm.localhost/sitecore/> — `admin` / `SITECORE_ADMIN_PASSWORD` from `local-containers/.env` |
| Authoring GraphQL IDE | <https://xmcloudcm.localhost/sitecore/api/authoring/graphql/ide/> — add header `Authorization: Bearer <accessToken from .sitecore/user.json>` |
| Rendering host | <https://nextjs.xmc-starter-js.localhost> — errors until a site exists in the local CM |
| Traefik dashboard | <http://localhost:8079> |
| Solr | <http://localhost:8984> |
| SQL Server | `localhost,14330` — `sa` / `SQL_SA_PASSWORD` |

### Point the host at it

```bash
pnpm dev               # Vite banner: token yes (...\.sitecore\user.json [default])
pnpm probe:endpoints   # xmc.authoring should come back PRESENT
```

Read the probe by status class: `404` means absent, `401`/`403` present but unauthorised,
`200`/`400` present. Update `verified` and `status` in `packages/protocol/src/routes.ts` from
the results.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` | The Docker CLI is on the Linux engine. `docker context use desktop-windows`, and make sure Docker Desktop is in Windows containers mode. `up.ps1` checks this before doing anything. |
| `ERR_CONNECTION_REFUSED` on `xmcloudcm.localhost` | Nothing is listening on 443 — the stack is not running. Check `docker ps` and `pnpm sitecore:logs`. |
| `up.ps1` stops with *port 443 is already in use* | Another stack is up, typically another starter clone. Run `docker compose down` in that repo's `local-containers`. |
| `xmc.authoring` returns `401` after it worked | The token expired. `dotnet sitecore cloud login` from the repo root, then restart `pnpm dev`. |
| `xmc.authoring` returns `502` "does the CM allow…" | CORS. Check `LocalMarketplace.CORS.config` reached the CM (see Caveats). |
| Certificate warning in the browser | `mkcert -install` did not run elevated. Re-run `init.ps1` from an elevated shell. |

Environment variables, read by `pnpm dev` and `pnpm probe:endpoints`:

| Variable | Default | Purpose |
|---|---|---|
| `SML_LOCAL_CM` | `https://xmcloudcm.localhost` | Local CM base URL |
| `ACCESS_TOKEN` | — | Bearer token for authenticated calls, overrides any `user.json` |
| `SML_SITECORE_USER_JSON` | `<repo>/.sitecore/user.json` | Where to read a token from instead |
| `SML_INSECURE_TLS` | `1` | Probe only: accept the container's self-signed dev cert |

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
- **The host page holds the token, like Cloud Portal.** `host.request` is fulfilled by a
  `fetch` from the host page to the CM with `Authorization: Bearer`; the app iframe cannot read
  it. Only the dev server injects it — `vite build` does not. The CM allows the host's origin via
  `local-containers/docker/deploy/platform/App_Config/Include/zzz/LocalMarketplace.CORS.config`,
  which the CM's dev entrypoint syncs into the webroot.
- **The SDK is pre-1.0.** The origin allowlist, the `:query` suffix convention and the
  `host.request` payload are unversioned internals. Versions are pinned exactly; `pnpm test`
  fails loudly if any of them move.
