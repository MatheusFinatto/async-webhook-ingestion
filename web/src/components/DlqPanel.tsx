import { useCallback, useEffect, useState } from 'react';
import { fetchDlq, type DlqEntry } from '../lib/api';
import { Empty, Panel } from './ui';

interface DlqPanelProps {
  deadCount: number;
  selectedId: string | null;
  onSelect: (correlationId: string) => void;
}

export function DlqPanel({ deadCount, selectedId, onSelect }: DlqPanelProps) {
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchDlq();
      setEntries(page.data);
      setError(null);
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
      action={
        <button
          type="button"
          onClick={() => void refresh()}
          className="mono text-xs text-fg-muted hover:text-fg"
        >
          {loading ? '…' : 'refresh'}
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
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
