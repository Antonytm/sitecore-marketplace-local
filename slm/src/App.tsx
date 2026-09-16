import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXTENSION_POINTS,
  buildPagesContext,
  buildSiteContext,
  type ExtensionPoint,
  type LocalAppRecord,
  type LocalAppsConfig,
} from './protocol/index.ts';
import rawConfig from '../apps.json';
import { HostSession, type LogEntry } from './host-bridge';
import { buildHandlers, type HostContextState } from './handlers';
import { Inspector } from './components/Inspector';

const config = rawConfig as LocalAppsConfig;

export function App() {
  const [app, setApp] = useState<LocalAppRecord>(config.apps[0]);
  const [extensionPoint, setExtensionPoint] = useState<ExtensionPoint>('standalone');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [pagesContext, setPagesContext] = useState<unknown>(() => buildPagesContext());
  const [fieldValue, setFieldValue] = useState<unknown>('');

  const frameRef = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef<HostSession | null>(null);
  const seqRef = useRef(0);

  // Handlers read live state through a ref so the session never has to be torn
  // down just because the user edited the page context.
  const stateRef = useRef<HostContextState>({
    app,
    extensionPoint,
    route: app.routes[extensionPoint] ?? '/',
    pagesContext,
    siteContext: buildSiteContext(),
    fieldValue,
  });

  useEffect(() => {
    stateRef.current = {
      app,
      extensionPoint,
      route: app.routes[extensionPoint] ?? '/',
      pagesContext,
      siteContext: stateRef.current.siteContext,
      fieldValue,
    };
  }, [app, extensionPoint, pagesContext, fieldValue]);

  const append = useCallback((entry: Omit<LogEntry, 'seq' | 'at'>) => {
    seqRef.current += 1;
    const full: LogEntry = { ...entry, seq: seqRef.current, at: Date.now() };
    setLog((prev) => [...prev.slice(-499), full]);
  }, []);

  const note = useCallback(
    (message: string) => {
      append({ direction: 'out', kind: 'note', label: 'host', detail: message });
    },
    [append],
  );

  const route = app.routes[extensionPoint];
  const src = route ? app.origin + route : null;

  // One session per (app, extension point). Changing either reloads the iframe,
  // so the old bridge must go with it.
  useEffect(() => {
    if (!src) return;

    setLog([]);
    seqRef.current = 0;
    setConnected(false);

    const session = new HostSession({
      appOrigin: app.origin,
      handlers: buildHandlers({
        getState: () => stateRef.current,
        setPagesContext,
        setFieldValue,
        onNote: note,
      }),
      onLog: append,
    });
    sessionRef.current = session;

    return () => {
      session.destroy();
      sessionRef.current = null;
    };
  }, [src, app.origin, append, note]);

  // Poll for the handshake completing. The bridge exposes `isConnected()` but
  // no callback for it.
  useEffect(() => {
    const timer = setInterval(() => {
      setConnected(sessionRef.current?.isConnected() ?? false);
    }, 400);
    return () => clearInterval(timer);
  }, []);

  const handleFrameLoad = useCallback(() => {
    const frame = frameRef.current?.contentWindow;
    if (frame && sessionRef.current) sessionRef.current.attach(frame);
  }, []);

  const availablePoints = useMemo(
    () => EXTENSION_POINTS.filter((p) => app.routes[p]),
    [app],
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Local Marketplace Host</h1>
        <p className="origin">{config.hostOrigin}</p>

        <label className="field">
          <span>App</span>
          <select
            value={app.id}
            onChange={(e) => {
              const next = config.apps.find((a) => a.id === e.target.value)!;
              setApp(next);
              if (!next.routes[extensionPoint]) {
                setExtensionPoint(EXTENSION_POINTS.find((p) => next.routes[p]) ?? 'standalone');
              }
            }}
          >
            {config.apps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Extension point</span>
          <select
            value={extensionPoint}
            onChange={(e) => setExtensionPoint(e.target.value as ExtensionPoint)}
          >
            {availablePoints.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <div className={`status ${connected ? 'ok' : 'pending'}`}>
          {connected ? 'handshake complete' : 'waiting for handshake…'}
        </div>

        {!connected && (
          <p className="hint">
            The app must pass <code>origin: '{config.hostOrigin}'</code> to{' '}
            <code>ClientSDK.init</code>. Without it the SDK only trusts
            <code>*.sitecorecloud.io</code> and will ignore this host.
          </p>
        )}

        {extensionPoint === 'xmc:pages:customfield' && (
          <p className="hint">
            Field value: <code>{JSON.stringify(fieldValue)}</code>
          </p>
        )}
      </aside>

      <main className={`stage stage--${extensionPoint.replace(/[:.]/g, '-')}`}>
        {src ? (
          <iframe
            key={src}
            ref={frameRef}
            src={src}
            title={`${app.name} @ ${extensionPoint}`}
            onLoad={handleFrameLoad}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <p className="empty">This app declares no route for {extensionPoint}.</p>
        )}
      </main>

      <Inspector entries={log} onClear={() => setLog([])} />
    </div>
  );
}
