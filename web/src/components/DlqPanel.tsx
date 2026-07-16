import { useCallback, useEffect, useState } from 'react';
import { fetchDlq, type DlqEntry } from '../lib/api';
import { Empty, Panel } from './ui';

interface DlqPanelProps {
  deadCount: number;
  selectedId: string | null;
  onSelect: (correlationId: string) => void;
}

function formatPayload(payload: string | null): string {
  if (payload === null) {
    return '(no payload captured)';
  }
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function DlqPanel({ deadCount, selectedId, onSelect }: DlqPanelProps) {
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchDlq();
      setEntries(page.data);
      setError(null);
      setUpdatedAt(Date.now());
    } catch {
      setError('GET /dlq unreachable. Is the backend up?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, deadCount]);

  return (
    <Panel
      title="Dead letter queue"
      info="Events that failed for good, with every retry exhausted. Click one to see why it landed here. Refresh re-reads GET /dlq from the API."
      action={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-busy={loading}
          className="mono flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:cursor-wait disabled:opacity-60"
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={loading ? 'animate-spin' : undefined}
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v5h-5" />
          </svg>
          refresh
        </button>
      }
    >
      {error ? (
        <Empty>{error}</Empty>
      ) : entries.length === 0 ? (
        <Empty>No dead-lettered messages yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry.correlationId)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  selectedId === entry.correlationId
                    ? 'border-border-strong bg-surface-2'
                    : 'border-border-subtle hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="mono truncate" style={{ maxWidth: '60%' }}>
                    {entry.correlationId}
                  </span>
                  <span className="mono text-fg-faint">
                    attempts {entry.attempts}
                  </span>
                </div>
                <div className="mt-1 text-fg-muted">{entry.reason}</div>
                <div className="mono mt-0.5 text-[10px] text-fg-faint">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </div>
              </button>
              {selectedId === entry.correlationId ? (
                <div className="mt-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                  <dl className="flex flex-col gap-1">
                    <DetailRow label="event_id" value={entry.eventId ?? '(none)'} />
                    <DetailRow
                      label="message_id"
                      value={entry.messageId ?? '(none)'}
                    />
                    <DetailRow
                      label="failed_at"
                      value={new Date(entry.createdAt).toLocaleString()}
                    />
                  </dl>
                  <div className="mt-2 text-[10px] uppercase tracking-wider text-fg-faint">
                    payload
                  </div>
                  <pre className="mono mt-1 max-h-40 overflow-auto rounded bg-surface p-2 text-[11px] leading-relaxed">
                    {formatPayload(entry.payload)}
                  </pre>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!error && updatedAt !== null ? (
        <p className="mono mt-3 text-[10px] text-fg-faint">
          {entries.length} shown · updated{' '}
          {new Date(updatedAt).toLocaleTimeString()}
        </p>
      ) : null}
    </Panel>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-fg-faint">{label}</dt>
      <dd className="mono break-all text-fg-muted">{value}</dd>
    </div>
  );
}
