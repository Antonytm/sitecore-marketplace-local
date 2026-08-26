/**
 * Records every postMessage crossing the iframe boundary.
 *
 * Must be installed BEFORE `ClientSDK.init`, otherwise the handshake - the one
 * exchange you most want to see - has already happened by the time the tap is
 * listening.
 *
 * Outbound is captured by replacing `window.parent.postMessage`. That is a
 * same-realm property on our own `window.parent` reference, so it is patchable
 * even though the parent document is cross-origin.
 */

export interface TapEntry {
  seq: number;
  at: number;
  direction: 'in' | 'out';
  targetOrigin?: string;
  origin?: string;
  message: unknown;
}

const entries: TapEntry[] = [];
let seq = 0;
let installed = false;
const listeners = new Set<() => void>();

function record(entry: Omit<TapEntry, 'seq' | 'at'>) {
  seq += 1;
  entries.push({ ...entry, seq, at: Date.now() });
  listeners.forEach((fn) => fn());
}

export function installTap(): void {
  if (installed) return;
  installed = true;

  const original = window.parent.postMessage.bind(window.parent);
  (window.parent as Window).postMessage = ((message: unknown, targetOrigin: string, transfer?: unknown[]) => {
    record({ direction: 'out', targetOrigin, message });
    return (original as (...args: unknown[]) => unknown)(message, targetOrigin, transfer);
  }) as typeof window.parent.postMessage;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || !('type' in data)) return;
    record({ direction: 'in', origin: event.origin, message: data });
  });
}

export function getEntries(): TapEntry[] {
  return entries;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clear(): void {
  entries.length = 0;
  seq = 0;
  listeners.forEach((fn) => fn());
}

/**
 * Values worth scrubbing before a transcript is committed. Bearer tokens never
 * cross this boundary (the host attaches them), but the user's real name and
 * email do, via `host.user`.
 */
const SENSITIVE = /(email|mail|token|authorization|secret|preferred_username|sub)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof ArrayBuffer) {
    return `<ArrayBuffer ${value.byteLength} bytes>`;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) =>
        SENSITIVE.test(key) && typeof val === 'string'
          ? [key, '<redacted>']
          : [key, redact(val)],
      ),
    );
  }
  return value;
}
