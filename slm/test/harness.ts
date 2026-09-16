/**
 * A two-window postMessage bus, so the real SDK can be driven in Node.
 *
 * @sitecore-marketplace-sdk/core talks to the module-global `window`, and both
 * bridges therefore share one listener list. That is fine: each bridge filters
 * by `event.origin`, so tagging every dispatch with the *sender's* origin gives
 * correct routing - a bridge never sees its own traffic, because its own origin
 * is not the origin it trusts.
 */

type Listener = (event: { data: unknown; origin: string }) => void;

const listeners: Listener[] = [];

export function installWindow(selfOrigin: string): void {
  (globalThis as any).window = {
    location: { origin: selfOrigin },
    addEventListener: (type: string, fn: Listener) => {
      if (type === 'message') listeners.push(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
}

/** A postMessage target that stamps outgoing messages with `fromOrigin`. */
export function makeTarget(fromOrigin: string) {
  return {
    postMessage: (message: unknown) => {
      // Async, like the real thing - synchronous delivery would let the
      // handshake resolve before the sender has finished setting up.
      queueMicrotask(() => {
        for (const listener of [...listeners]) {
          listener({ data: structuredClone(message), origin: fromOrigin });
        }
      });
    },
  } as unknown as Window;
}

export function reset(): void {
  listeners.length = 0;
}
