import { useState } from 'react';
import type { LogEntry } from '../host-bridge';

/**
 * Live view of every message crossing the iframe boundary. This is the reason
 * to run a local host at all: in Cloud Portal the protocol is invisible.
 */
export function Inspector({
  entries,
  onClear,
}: {
  entries: LogEntry[];
  onClear: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const current = entries.find((e) => e.seq === selected);

  return (
    <section className="inspector">
      <header>
        <h2>Messages</h2>
        <span className="count">{entries.length}</span>
        <button type="button" onClick={onClear}>clear</button>
      </header>

      <div className="inspector-body">
        <ol className="entries">
          {entries.map((entry) => (
            <li key={entry.seq}>
              <button
                type="button"
                className={[
                  'entry',
                  `entry--${entry.direction}`,
                  entry.ok === false ? 'entry--error' : '',
                  entry.seq === selected ? 'entry--selected' : '',
                ].join(' ')}
                onClick={() => setSelected(entry.seq === selected ? null : entry.seq)}
              >
                <span className="arrow">{entry.direction === 'in' ? '\u2190' : '\u2192'}</span>
                <span className="kind">{entry.kind}</span>
                <span className="label">{entry.label}</span>
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="empty">No messages yet.</li>}
        </ol>

        {current && (
          <pre className="detail">{safeStringify(current.detail)}</pre>
        )}
      </div>
    </section>
  );
}

function safeStringify(value: unknown): string {
  if (value instanceof ArrayBuffer) {
    return `ArrayBuffer(${value.byteLength}) ${new TextDecoder().decode(value).slice(0, 2000)}`;
  }
  try {
    return JSON.stringify(value, replacer, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function replacer(_key: string, value: unknown) {
  if (value instanceof ArrayBuffer) {
    return `<ArrayBuffer ${value.byteLength} bytes: ${new TextDecoder().decode(value).slice(0, 500)}>`;
  }
  return value;
}
