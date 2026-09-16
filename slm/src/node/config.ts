import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HostConfig {
  /** Base URL of the local CM container. */
  cm: string;
  /** Bearer token forwarded on `requiresAuth` requests. */
  token: string | null;
  tokenSource: string;
  /** Trust the container's self-signed dev certificate. */
  insecureTls: boolean;
}

interface CliEndpoint {
  host?: string;
  accessToken?: string;
  allowWrite?: boolean;
}

/**
 * Resolves a token for the local CM.
 *
 * The container stack in `sitecore/` federates authentication to Auth0 at
 * `auth.sitecorecloud.io` (see `SITECORE_FedAuth_dot_Auth0_dot_*` in its .env),
 * so a cloud-issued token IS accepted by the local instance. That is exactly what
 * `sitecore/scripts/up.ps1` sets up when it runs:
 *
 *   dotnet sitecore cloud login
 *   dotnet sitecore connect --ref xmcloud --cm https://xmcloudcm.localhost --allow-write true -n default
 *
 * which writes an endpoint into `sitecore/.sitecore/user.json` pointing at the local CM.
 * So in the normal case there is nothing to do here beyond reading that file.
 *
 * Order of preference:
 *   1. ACCESS_TOKEN                     explicit override
 *   2. the user.json endpoint whose host matches our CM
 *   3. the endpoint named by `defaultEndpoint`
 *   4. none - requests go out unauthenticated and the CM will 401
 */
function pickEndpoint(
  parsed: Record<string, any>,
  cm: string,
): { name: string; endpoint: CliEndpoint } | null {
  const endpoints = (parsed?.endpoints ?? {}) as Record<string, CliEndpoint>;
  const entries = Object.entries(endpoints).filter(([, e]) => e?.accessToken);
  if (entries.length === 0) return null;

  const wanted = cm.replace(/\/+$/, '').toLowerCase();
  const byHost = entries.find(
    ([, e]) => e.host?.replace(/\/+$/, '').toLowerCase() === wanted,
  );
  if (byHost) return { name: byHost[0], endpoint: byHost[1] };

  const preferred = parsed?.defaultEndpoint ?? 'default';
  const byName = entries.find(([name]) => name === preferred);
  if (byName) return { name: byName[0], endpoint: byName[1] };

  return { name: entries[0][0], endpoint: entries[0][1] };
}

function resolveToken(cm: string): { token: string | null; source: string } {
  if (process.env.ACCESS_TOKEN) {
    return { token: process.env.ACCESS_TOKEN, source: 'ACCESS_TOKEN' };
  }

  const candidates = [
    process.env.SML_SITECORE_USER_JSON,
    // sitecore/, where up.ps1 runs the Sitecore CLI. pnpm runs this package with
    // cwd = slm, so the cwd candidate below never reaches it.
    fileURLToPath(new URL('../../../sitecore/.sitecore/user.json', import.meta.url)),
    join(process.cwd(), 'sitecore', '.sitecore', 'user.json'),
    join(homedir(), '.sitecore', 'user.json'),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const picked = pickEndpoint(parsed, cm);
      if (picked?.endpoint.accessToken) {
        const writable = picked.endpoint.allowWrite === false ? ' (read-only)' : '';
        return {
          token: picked.endpoint.accessToken,
          source: `${path} [${picked.name}]${writable}`,
        };
      }
      if (parsed?.accessToken) return { token: parsed.accessToken, source: path };
    } catch {
      // Malformed user.json is not fatal - fall through to the next candidate.
    }
  }

  return { token: null, source: 'none' };
}

export function loadConfig(): HostConfig {
  const cm = process.env.SML_LOCAL_CM ?? 'https://xmcloudcm.localhost';
  const { token, source } = resolveToken(cm);
  return {
    cm,
    token,
    tokenSource: source,
    insecureTls: process.env.SML_INSECURE_TLS !== '0',
  };
}
