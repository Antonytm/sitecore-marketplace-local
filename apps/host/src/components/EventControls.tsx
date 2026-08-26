import { useState } from 'react';
import type { ExtensionPoint } from '@sml/protocol';

/**
 * Push host -> app events on demand.
 *
 * Subscriptions (`client.query(key, { subscribe: true })`) listen on the bare
 * key, with no `:query` suffix - see `handleSubscription` in the client SDK -
 * so these event names are the query keys verbatim.
 */
export function EventControls({
  extensionPoint,
  pagesContext,
  onPagesContextChange,
  onEmit,
  events,
}: {
  extensionPoint: ExtensionPoint;
  pagesContext: unknown;
  onPagesContextChange: (next: unknown) => void;
  onEmit: (event: string, payload: unknown) => void;
  events: Record<string, string>;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(pagesContext, null, 2));
  const [error, setError] = useState<string | null>(null);

  const pushPagesContext = () => {
    try {
      const parsed = JSON.parse(draft);
      setError(null);
      onPagesContextChange(parsed);
      onEmit(events.pagesContext, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invalid JSON');
    }
  };

  const isPagesPoint = extensionPoint.startsWith('xmc:pages');

  return (
    <div className="events">
      <h2>Emit events</h2>

      <label className="field">
        <span>pages.context</span>
        <textarea
          rows={10}
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}

      <button type="button" onClick={pushPagesContext}>
        push pages.context
      </button>

      <button
        type="button"
        onClick={() => onEmit(events.pagesContentLayoutUpdated, { updatedAt: Date.now() })}
      >
        push layoutUpdated
      </button>

      <button
        type="button"
        onClick={() =>
          onEmit(events.pagesContentFieldsUpdated, {
            updatedAt: Date.now(),
            fields: [{ name: 'Title', value: 'Edited in local host' }],
          })
        }
      >
        push fieldsUpdated
      </button>

      {!isPagesPoint && (
        <p className="hint">
          The Pages events are only meaningful at the <code>xmc:pages:*</code>{' '}
          extension points, but the host will send them anywhere so you can see
          how an app copes.
        </p>
      )}
    </div>
  );
}
