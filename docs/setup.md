# Setup runbook

Gets you to three things, in order:

1. **SitecoreAI running locally** as Docker containers
2. **A Marketplace app running locally**, in a local host
3. **The Authoring API working** from inside that app, against your local content

Steps 2 and 3 are quick. Step 1 is the long pole — budget a couple of hours the first time,
most of it image pulls.

---

## Step 1 — SitecoreAI in Docker

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

### 1.2 Clone the foundation head

```powershell
git clone https://github.com/sitecorelabs/xmcloud-foundation-head
cd xmcloud-foundation-head
```

### 1.3 Initialise

**In an elevated PowerShell** — `init.ps1` writes Windows hosts-file entries and installs an
mkcert root CA, both of which need administrator rights:

```powershell
.\local-containers\scripts\init.ps1 -InitEnv -LicenseXmlPath "C:\path\to\license.xml" -AdminPassword "<choose one>"
```

This generates `local-containers/.env`, issues certificates for `xmcloudcm.localhost`, and adds
the hosts entries. You only run it once.

### 1.4 Bring it up

```powershell
.\local-containers\scripts\up.ps1
```

`up.ps1` builds and starts the containers, waits for Traefik to expose the CM, then does the
authentication and seeding for you:

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
> `up.ps1` leaves it in `xmcloud-foundation-head/.sitecore/user.json` under the `default`
> endpoint, pointed at `https://xmcloudcm.localhost`.

### 1.5 Verify

<https://xmcloudcm.localhost/sitecore> should load and let you log in as `admin` with the
password you chose.

**Checkpoint:** you can browse the content tree in Content Editor.

---

## Step 2 — A Marketplace app running locally

### 2.1 Start the local host and gateway

```bash
cd S:/source/sitecore-marketplace-local
pnpm install
pnpm test     # six protocol contracts, verified against the real SDK
pnpm dev      # host :5173, gateway :8787
```

`pnpm test` is worth the 10 seconds — it proves the origin bypass and the action-naming
convention still hold in the pinned SDK version before you go hunting for bugs elsewhere.

### 2.2 Get an app

```bash
git clone https://github.com/Sitecore/marketplace-starter
cd marketplace-starter
npm install
```

### 2.3 The one change that makes it work

Edit `src/utils/hooks/useMarketplaceClient.ts`:

```ts
const config = {
  target: window.parent,
  origin: process.env.NEXT_PUBLIC_MP_HOST_ORIGIN,  // add this line
  modules: [XMC],
};
```

and create `.env.local` in the starter:

```
NEXT_PUBLIC_MP_HOST_ORIGIN=http://localhost:5173
```

**Why:** without `origin`, the SDK only trusts `*.sitecorecloud.io` and silently ignores a
localhost host — you get a handshake timeout with no useful error. Reading it from an env var
means the same code still deploys to Cloud Portal unchanged, where the variable is unset.

### 2.4 Run and verify

```bash
npm run dev    # starter on :3000
```

The starter is already registered in `config/local-apps.json`. At <http://localhost:5173>:

1. Select **Marketplace Starter**.
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

### 3.1 Point the gateway at your token

The gateway reads `.sitecore/user.json`, but that file lives in the **foundation-head** repo,
not this one. Tell it where:

```bash
SML_SITECORE_USER_JSON="C:/path/to/xmcloud-foundation-head/.sitecore/user.json" pnpm dev:gateway
```

Or on Windows PowerShell:

```powershell
$env:SML_SITECORE_USER_JSON = "C:\path\to\xmcloud-foundation-head\.sitecore\user.json"
pnpm dev:gateway
```

The startup banner should now read `token yes (...[default])`. If it says `NONE`, the path is
wrong or `up.ps1` did not complete its login.

The gateway picks the endpoint whose `host` matches your CM, so a `user.json` holding both a
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
| `502` | gateway could not connect — containers down |

`xmc.authoring` is the row that matters for this step; it should come back **PRESENT**.

The `xmc.xmapp` / `sites` / `pages` rows answer the one open question in
[`findings.md`](findings.md) — whether the local CM serves the XM Apps API. Whatever they say,
update `verified` and `status` in `packages/protocol/src/routes.ts` to match.

### 3.3 Call it from the app

The Authoring API reaches the host as `host.request` on `/v1/authoring/graphql`, which the
gateway rewrites to `https://xmcloudcm.localhost/sitecore/api/authoring/graphql/v1`.

From any Marketplace app:

```ts
const response = await client.mutate('xmc.authoring.graphql', {
  params: { body: { query: '{ __typename }' } },
});
```

`__typename` is the safe smoke test — it is valid against any GraphQL schema. Once it returns,
explore the real schema in the IDE (3.4) and write queries against your content tree.

Watch the host's message inspector while it runs: you will see `host.request` go out with the
origin-stripped path, and the gateway console log the rewrite to the local CM.

### 3.4 Optional — the GraphQL IDE

To browse the schema interactively, add to the `cm` service environment in
`local-containers/docker-compose.override.yml`:

```yaml
      Sitecore_GraphQL_ExposePlayground: "true"
```

Restart the CM container, then open
<https://xmcloudcm.localhost/sitecore/api/authoring/graphql/ide/>.

The IDE needs the token too — an API key will not do for the Authoring API. Add the
`accessToken` from `user.json` as an HTTP header:

```json
{ "Authorization": "Bearer <accessToken>" }
```

**Checkpoint:** a query issued from the Marketplace app returns items you can see in local
Content Editor.

---

## Notes

**No CORS work is needed.** The gateway talks to the CM server-side from Node, so the CM's
`SITECORE_GraphQL_CORS` setting is irrelevant to this setup. It also keeps the token out of the
browser.

**TLS.** The gateway accepts the container's self-signed certificate by default
(`SML_INSECURE_TLS=1`), scoped to its own HTTPS agent rather than the whole process. Since
`init.ps1` installed an mkcert root CA into the Windows trust store, you can tighten this:

```bash
SML_INSECURE_TLS=0 NODE_OPTIONS=--use-system-ca pnpm dev:gateway
```

**Tokens expire.** When `xmc.authoring` starts returning 401 after working, re-run
`dotnet sitecore cloud login` in the foundation-head repo and restart the gateway.

**Do not test publishing here.** `xmc.live` shares a path with `xmc.preview` and there is no
local Experience Edge, so both resolve to the CM preview endpoint. Content reads as published
when it is not.

**`xmc.search` and `xmc.agent` return 501.** No local equivalent exists.

Gateway environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SML_LOCAL_CM` | `https://xmcloudcm.localhost` | Local CM base URL |
| `SML_SITECORE_USER_JSON` | `./.sitecore/user.json` | Where to read the token from |
| `SML_LOCAL_TOKEN` | — | Explicit token, overrides the file |
| `SML_GATEWAY_PORT` | `8787` | |
| `SML_INSECURE_TLS` | `1` | Accept the self-signed dev cert |
