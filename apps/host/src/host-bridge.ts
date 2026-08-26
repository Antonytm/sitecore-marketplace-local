import { CoreSDK } from '@sitecore-marketplace-sdk/core';

export type Direction = 'in' | 'out';

export interface LogEntry {
  seq: number;
  at: number;
  direction: Direction;
  kind: 'handshake' | 'request' | 'response' | 'event' | 'note';
  /** Action or event name, when the envelope has one. */
  label: string;
  detail: unknown;
  ok?: boolean;
}

export type RequestHandler = (payload: any) => unknown | Promise<unknown>;

export interface HostSessionOptions {
  /** Origin the app iframe is served from. Passed as `targetOrigin`. */
  appOrigin: string;
  handlers: Record<string, RequestHandler>;
  onLog: (entry: Omit<LogEntry, 'seq' | 'at'>) => void;
}

/**
 * Wraps CoreSDK in host mode against a single app iframe.
 *
 * The important part is `type: 'host'`. The SDK's PostMessageBridge implements
 * both sides of the protocol; Cloud Portal is simply the other consumer of this
 * same code path. Nothing here is a reimplementation of the wire format - we
 * drive the shipped bridge.
 *
 * One session at a time. The bridge installs a global `message` listener and
 * filters by `targetOrigin`, so concurrent sessions against different app
 * origins would each ignore the other's traffic, but the iframe lifecycle is
 * simpler to reason about if the host mounts one extension point at a time -
 * which is also what the real host does.
 */
export class HostSession {
  private core: CoreSDK;
  private opts: HostSessionOptions;
  private targetSet = false;

  constructor(opts: HostSessionOptions) {
    this.opts = opts;

    this.core = new CoreSDK({
      // No `target` yet: this starts the bridge in listener mode so it can
      // receive (and buffer) the client's handshake init before the iframe has
      // finished loading.
      selfOrigin: window.location.origin,
      targetOrigin: opts.appOrigin,
      timeout: 30_000,
    });

    this.core.initialize({
      type: 'host',
      selfOrigin: window.location.origin,
      targetOrigin: opts.appOrigin,
      version: '1',
    });

    for (const [action, handler] of Object.entries(opts.handlers)) {
      this.core.onRequest(action, async (payload: unknown) => {
        this.log({ direction: 'in', kind: 'request', label: action, detail: payload });
        try {
          const result = await handler(payload);
          this.log({ direction: 'out', kind: 'response', label: action, detail: result, ok: true });
          return result;
        } catch (err) {
          this.log({
            direction: 'out',
            kind: 'response',
            label: action,
            detail: err instanceof Error ? err.message : err,
            ok: false,
          });
          throw err;
        }
      });
    }

    // The bridge prefers an exact action match and falls back to the name
    // without its `:query`/`:mutation` suffix, so explicit handlers always win.
    // This only fires for actions we did not anticipate - which is exactly the
    // signal we want when the SDK adds one.
    this.core.onRequest('*', (message: any) => {
      const action = message?.action ?? 'unknown';
      this.log({
        direction: 'in',
        kind: 'request',
        label: `UNHANDLED ${action}`,
        detail: message?.payload,
        ok: false,
      });
      throw new Error(
        `Local host has no handler for "${action}". Add one in src/handlers.ts.`,
      );
    });

    this.installInboundTap();
  }

  /** Call on iframe load. Flushes any handshake buffered while loading. */
  attach(frame: Window): void {
    if (this.targetSet) return;
    this.targetSet = true;

    // The bridge only ever calls `target.postMessage`, so a thin stand-in gives
    // us complete outbound visibility - including the handshake response, which
    // the bridge generates internally and never surfaces to callers.
    const tap = {
      postMessage: (message: any, targetOrigin: string) => {
        this.log({
          direction: 'out',
          kind: message?.type === 'handshake' ? 'handshake' : (message?.type ?? 'note'),
          label: message?.action ?? message?.event ?? message?.type ?? 'message',
          detail: message,
        });
        frame.postMessage(message, targetOrigin);
      },
    } as unknown as Window;

    this.core.setTarget(tap);
    void this.core.connect();
  }

  /** Pushes an event to the app. Subscriptions listen on the bare key. */
  emit(event: string, payload: unknown): void {
    this.core.emit(event, payload);
  }

  isConnected(): boolean {
    return this.core.isConnected();
  }

  destroy(): void {
    window.removeEventListener('message', this.inboundTap);
    this.core.destroy();
  }

  private inboundTap = (event: MessageEvent) => {
    if (event.origin !== this.opts.appOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || !('type' in data)) return;
    // Requests are logged by the handler wrapper with their resolved result;
    // logging them here too would double every entry.
    if (data.type === 'request') return;
    this.log({
      direction: 'in',
      kind: data.type === 'handshake' ? 'handshake' : data.type,
      label: data.action ?? data.event ?? data.type,
      detail: data,
    });
  };

  private installInboundTap(): void {
    window.addEventListener('message', this.inboundTap);
  }

  private log(entry: Omit<LogEntry, 'seq' | 'at'>): void {
    this.opts.onLog(entry);
  }
}
