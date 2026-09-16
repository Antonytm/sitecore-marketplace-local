# Setup runbook

Gets you to three things, in order:

1. **SitecoreAI running locally** as Docker containers
2. **A Marketplace app running locally**, in a local host
3. **The Authoring API working** from inside that app, against your local content

Steps 2 and 3 are quick. Step 1 is the long pole — budget a couple of hours the first time,
most of it image pulls.

---

## Step 1 — SitecoreAI in Docker

The container stack lives in this repo under `sitecore/`. Addresses are in the README's
[Running SitecoreAI locally](../README.md#running-sitecoreai-locally).

### 1.1 Prerequisites

| | |
|---|---|
| OS | Windows 10/11 Pro or Enterprise |
| Docker Desktop | switched to **Windows containers** (right-click tray icon → *Switch to Windows containers*) |
| Sitecore licence | a `license.xml` file |
| .NET SDK | for Sitecore CLI |
| Node.js | current LTS |
| Disk | ~40 GB free for images |

Hyper-V/containers Windows features must be on, and Docker must not be in Linux-container mode
— the CM image is Windows-based and will fail to pull otherwise.

### 1.2 Initialise

**In an elevated PowerShell** — `init.ps1` writes Windows hosts-file entries and installs an
mkcert root CA, both of which need administrator rights:

```powershell
cd <repo>
.\sitecore\scripts\init.ps1 -InitEnv -LicenseXmlPath "C:\license\license.xml" -AdminPassword "<choose one>"
```

This copies `sitecore/.env.example` to `sitecore/.env` (gitignored), fills in
generated secrets, issues certificates for `xmcloudcm.localhost` and
`*.xmc-starter-js.localhost`, and adds the hosts entries. You only run it once.

### 1.3 Bring it up

```powershell
pnpm sitecore:up
```

`up.ps1` first checks that Docker is on the Windows engine and that port 443 is free. It then
builds and starts the containers, waits for Traefik to expose the CM, and — from inside
`sitecore/`, where the CLI config lives — does the authentication and seeding for you:

```
dotnet sitecore cloud login
dotnet sitecore connect --ref xmcloud --cm https://xmcloudcm.localhost --allow-write true -n default
dotnet sitecore index schema-populate
dotnet sitecore index rebuild
dotnet sitecore ser push -i nextjs-starter
```

A browser window opens for device authorisation — approve it.

> **Note this, it matters for step 3:** the local CM federates authentication to Auth0 at
> `auth.sitecorecloud.io`, so your *cloud* login produces a token the *local* instance accepts.
> `up.ps1` leaves it in `sitecore/.sitecore/user.json` under the `default` endpoint, pointed
> at `https://xmcloudcm.localhost`.

### 1.4 Verify

<https://xmcloudcm.localhost/sitecore> should load and let you log in as `admin` with the
password you chose.

**Checkpoint:** you can browse the content tree in Content Editor.

`pnpm sitecore:down` stops the stack. Content persists in `sitecore/docker/data/`.

---

## Step 2 — A Marketplace app running locally

### 2.1 Start the local host

```bash
cd <repo>
git submodule update --init
pnpm install
pnpm test     # six protocol contracts, verified against the real SDK
pnpm dev      # host :5173
```

`pnpm test` is worth the 10 seconds — it proves the origin bypass and the action-naming
convention still hold in the pinned SDK version before you go hunting for bugs elsewhere.

### 2.2 The apps

Both live under `apps/` as git submodules, already registered in `slm/apps.json`:

| App | Path | Port | Extension points |
|---|---|---|---|
| Marketplace Starter | `apps/marketplace-starter` | `:3000` | all five |
| Sitecore JavaScript Extensions | `apps/SJE` (app is in `src/ide/`) | `:3002` | standalone, fullscreen |

### 2.3 The one change that makes it work

A Marketplace app must pass `origin` to `ClientSDK.init`, or the SDK only trusts
`*.sitecorecloud.io` and silently ignores a localhost host — you get a handshake timeout with
no useful error. Reading it from an env var means the same code still deploys to Cloud Portal
unchanged, where the variable is unset.

**Neither bundled app does this out of the box** — SJE is forked from the starter and carries
the same unpatched `ClientSDK.init`. Both are submodules, so the change ships as a patch file
rather than a committed edit, keeping the submodules clean:

```bash
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

Each patch adds one line to that app's `src/utils/hooks/useMarketplaceClient.ts`:

```ts
const config = {
  target: window.parent,
  origin: process.env.NEXT_PUBLIC_MP_HOST_ORIGIN,  // <- this
  modules: [XMC],
};
```

Two path traps worth naming: SJE's app is in `src/ide/`, so install and run from there — but
`git apply` runs from the submodule *root*, because the patch paths are relative to it.

### 2.4 Run and verify

```bash
pnpm dev:starter   # starter on :3000
pnpm dev:sje       # SJE on :3002
```

At <http://localhost:5173>:

1. Select an app.
2. The status chip flips to **`handshake complete`**.
3. The inspector shows the handshake pair, then `application.context:query`, `host.user:query`
   and the rest resolving.
4. Switch extension points — each reloads the iframe in framing that matches the real host
   (context panel narrow, custom field as a dialog).

**If the handshake never completes**, it is almost always 2.3. Open devtools on the *iframe* and
look for `[client SDK] Invalid message origin`.

**Checkpoint:** handshake complete, queries resolving. `xmc.*` calls still fail — that is step 3.

---

## Step 3 — The Authoring API

### 3.1 Check the host has your token

`pnpm sitecore:up` logs in from `sitecore/`, so the token lands in
`sitecore/.sitecore/user.json` — the first place the host's dev server looks. Nothing to
configure:

```bash
pnpm dev
```

The startup banner should read `token yes (...\sitecore\.sitecore\user.json [default])`. If it
says `NONE`, `up.ps1` did not complete its login. From `sitecore/`, re-run:

```powershell
dotnet sitecore cloud login
dotnet sitecore connect --ref xmcloud --cm https://xmcloudcm.localhost --allow-write true -n default
```

To use a token from elsewhere, set `SML_SITECORE_USER_JSON` to that file, or `SML_ACCESS_TOKEN`
to a bearer token.

It picks the endpoint whose `host` matches your CM, so a `user.json` holding both a
cloud and a local endpoint resolves to the local one.

### 3.2 Check what the CM actually serves

```bash
pnpm probe:endpoints
```

Read by status class, not pass/fail:

| Status | Meaning |
|---|---|
| `200` / `400` | endpoint exists and is reachable |
| `401` / `403` | exists, but the token was rejected — revisit 3.1 |
| `404` | **absent** — no local equivalent, that namespace is a stub |
| `UNREACHABLE` | probe could not connect — containers down |

`xmc.authoring` is the row that matters for this step; it should come back **PRESENT**.

The probe runs under Node rather than in the browser, which is why it can tell a stopped
container from a CORS rejection — the browser cannot.

The `xmc.xmapp` / `sites` / `pages` rows answer the one open question in
[`findings.md`](findings.md) — whether the local CM serves the XM Apps API. Whatever they say,
update `verified` and `status` in `slm/src/protocol/routes.ts` to match.

### 3.3 Call it from the app

The Authoring API reaches the host as `host.request` on `/v1/authoring/graphql`. The host
rewrites it to `https://xmcloudcm.localhost/sitecore/api/authoring/graphql/v1` and fetches it
from the browser with the bearer token — the same thing Cloud Portal does.

From any Marketplace app:

```ts
const response = await client.mutate('xmc.authoring.graphql', {
  params: { body: { query: '{ __typename }' } },
});
```

`__typename` is the safe smoke test — it is valid against any GraphQL schema. Once it returns,
explore the real schema in the IDE (3.4) and write queries against your content tree.

Watch the host's message inspector while it runs: you will see `host.request` go out with the
origin-stripped path, and the Network tab show the matching request to `xmcloudcm.localhost`.

### 3.4 Optional — the GraphQL IDE

The stack sets `Sitecore_GraphQL_ExposePlayground: "true"` on the CM (see
`sitecore/docker-compose.override.yml`), so the IDE is already on at
<https://xmcloudcm.localhost/sitecore/api/authoring/graphql/ide/>.

The IDE needs the token too — an API key will not do for the Authoring API. Add the
`accessToken` from `sitecore/.sitecore/user.json` as an HTTP header:

```json
{ "Authorization": "Bearer <accessToken>" }
```

**Checkpoint:** a query issued from the Marketplace app returns items you can see in local
Content Editor.

---

## Notes

**CORS.** The host calls the CM from the browser, so the CM must allow `http://localhost:5173`.
`sitecore/docker/deploy/platform/App_Config/Include/zzz/LocalMarketplace.CORS.config`
adds it to the Authoring GraphQL policy; the CM's dev entrypoint syncs `sitecore/docker/deploy/platform`
into the webroot, so no image rebuild is needed.

**The token is in the host page**, as in Cloud Portal. The app iframe is cross-origin and cannot
read it. Only `pnpm dev` injects it; `vite build` does not. Because Vite injects it at startup,
a freshly refreshed token needs a dev-server restart before the page sees it.

**TLS.** The browser trusts the mkcert certificate `init.ps1` installed. The Node probe accepts
the self-signed certificate by default (`SML_INSECURE_TLS=1`); to tighten it:

```bash
SML_INSECURE_TLS=0 NODE_OPTIONS=--use-system-ca pnpm probe:endpoints
```

**Tokens expire.** When `xmc.authoring` starts returning 401 after working, re-run
`dotnet sitecore cloud login` from `sitecore/` and restart `pnpm dev`.

**Do not test publishing here.** `xmc.live` shares a path with `xmc.preview` and there is no
local Experience Edge, so both resolve to the CM preview endpoint. Content reads as published
when it is not.

**`xmc.search` and `xmc.agent` return 501.** No local equivalent exists.

Environment variables, read by `pnpm dev` and `pnpm probe:endpoints`:

| Variable | Default | Purpose |
|---|---|---|
| `SML_LOCAL_CM` | `https://xmcloudcm.localhost` | Local CM base URL |
| `SML_SITECORE_USER_JSON` | `./sitecore/.sitecore/user.json` | Where to read the token from |
| `SML_ACCESS_TOKEN` | — | Explicit token, overrides the file |
| `SML_INSECURE_TLS` | `1` | Probe only: accept the self-signed dev cert |
