import { useCallback, useEffect, useState } from 'react';
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import { clear, getEntries, redact, subscribe, type TapEntry } from './tap';
import { runSuite, type SuiteResult } from './suite';

/**
 * The same build runs in two places, which is the point:
 *
 *   Cloud Portal   no `origin` passed, so the SDK falls back to its
 *                  `AllowedOrigins` allowlist and trusts *.sitecorecloud.io.
 *   Local host     `?hostOrigin=http://localhost:5173` sets `targetOrigin`,
 *                  which skips the allowlist entirely.
 *
 * If a transcript captured in Cloud Portal and one captured locally line up,
 * the local host is faithful.
 */
function resolveHostOrigin(): string | undefined {
  const fromQuery = new URLSearchParams(window.location.search).get('hostOrigin');
  return fromQuery ?? import.meta.env.VITE_HOST_ORIGIN ?? undefined;
}

export function App() {
  const [client, setClient] = useState<ClientSDK | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SuiteResult[]>([]);
  const [running, setRunning] = useState(false);
  const [, forceRender] = useState(0);

  const hostOrigin = resolveHostOrigin();

  useEffect(() => subscribe(() => forceRender((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    ClientSDK.init({ target: window.parent, origin: hostOrigin, modules: [XMC] })
      .then((sdk) => !cancelled && setClient(sdk))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [hostOrigin]);

  const run = useCallback(async () => {
    if (!client) return;
    setRunning(true);
    setResults([]);
    await runSuite(client, (result) => setResults((prev) => [...prev, result]));
    setRunning(false);
  }, [client]);

  const download = useCallback(() => {
    const transcript = {
      capturedAt: new Date().toISOString(),
      hostOrigin: hostOrigin ?? '(cloud - resolved from AllowedOrigins)',
      href: window.location.href,
      sdk: { client: '0.3.6', core: '0.3.5', xmc: '0.4.2' },
      results: redact(results),
      messages: redact(getEntries() as TapEntry[]),
    };
    const blob = new Blob([JSON.stringify(transcript, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `marketplace-transcript-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [results, hostOrigin]);

  const entries = getEntries();

  return (
    <main>
      <header>
        <h1>Marketplace protocol probe</h1>
        <p className="mode">
          host: <code>{hostOrigin ?? 'cloud (allowlist)'}</code>
          {' · '}
          {client ? <span className="ok">connected</span> : <span className="pending">connecting…</span>}
        </p>
      </header>

      {error && <p className="error">init failed: {error}</p>}

      <div className="actions">
        <button type="button" onClick={run} disabled={!client || running}>
          {running ? 'running…' : 'run suite'}
        </button>
        <button type="button" onClick={download} disabled={entries.length === 0}>
          download transcript
        </button>
        <button type="button" onClick={clear} disabled={entries.length === 0}>
          clear
        </button>
      </div>

      <section>
        <h2>Results</h2>
        <table>
          <tbody>
            {results.map((r) => (
              <tr key={`${r.kind}-${r.name}`} className={r.ok ? 'ok' : 'fail'}>
                <td>{r.ok ? 'ok' : 'fail'}</td>
                <td>{r.kind}</td>
                <td className="name">{r.name}</td>
                <td className="ms">{r.ms}ms</td>
                <td className="detail">{summarise(r.detail)}</td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr><td colSpan={5} className="muted">Run the suite to populate.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Messages <span className="muted">({entries.length})</span></h2>
        <pre>{JSON.stringify(redact(entries.slice(-40)), null, 2)}</pre>
      </section>
    </main>
  );
}

function summarise(detail: unknown): string {
  if (typeof detail === 'string') return detail.slice(0, 140);
  try {
    return JSON.stringify(redact(detail)).slice(0, 140);
  } catch {
    return String(detail);
  }
}
