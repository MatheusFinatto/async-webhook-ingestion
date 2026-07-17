import { useCallback, useEffect, useState } from 'react';
import { discardDlq, fetchDlq, replayDlq, type DlqEntry } from '../lib/api';
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

const MAX_ATTEMPTS = 4;

interface Diagnosis {
  badge: string;
  color: string;
  summary: string;
}

function diagnose(entry: DlqEntry): Diagnosis {
  const reason = entry.reason.toLowerCase();
  if (reason.includes('unparseable') || reason.includes('missing event_id')) {
    return {
      badge: 'poison message',
      color: 'var(--color-stage-dead)',
      summary:
        'The body could not even be parsed into an event, so there was nothing to retry.',
    };
  }
  if (reason.includes('permanent')) {
    return {
      badge: 'permanent error',
      color: 'var(--color-stage-dead)',
      summary:
        'The handler flagged this failure as unfixable, so it skipped the retry ladder and came straight here.',
    };
  }
  if (
    entry.attempts > 1 ||
    reason.includes('transient') ||
    reason.includes('attempt')
  ) {
    return {
      badge: 'retries exhausted',
      color: 'var(--color-stage-retry)',
      summary: `Failed ${entry.attempts} times across the retry ladder (5s, 30s, 2min) and gave up.`,
    };
  }
  return {
    badge: 'unknown',
    color: 'var(--text-faint)',
    summary: 'Dead-lettered without a reason the worker recognizes.',
  };
}

function AttemptDots({ attempts }: { attempts: number }) {
  return (
    <span
      className="flex items-center gap-1"
      title={`${attempts} of ${MAX_ATTEMPTS} attempts used`}
    >
      {Array.from({ length: MAX_ATTEMPTS }, (_, slot) => (
        <span
          key={slot}
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: 'var(--color-stage-retry)',
            opacity: slot < attempts ? 1 : 0.25,
          }}
        />
      ))}
      <span className="mono ml-0.5 text-[10px] text-fg-faint">
        {attempts}/{MAX_ATTEMPTS}
      </span>
    </span>
  );
}

export function DlqPanel({ deadCount, selectedId, onSelect }: DlqPanelProps) {
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayNote, setReplayNote] = useState<string | null>(null);

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

  const discard = useCallback(
    async (entry: DlqEntry) => {
      try {
        await discardDlq(entry.id);
        setReplayNote(null);
        await refresh();
      } catch {
        setReplayNote(`could not discard ${entry.eventId ?? entry.id}`);
      }
    },
    [refresh],
  );

  const replay = useCallback(
    async (entry: DlqEntry) => {
      setReplayingId(entry.id);
      setReplayNote(null);
      try {
        await replayDlq(entry.id);
        setReplayNote(
          `replayed ${entry.eventId ?? entry.id}: state reset, message republished, retry budget restarted`,
        );
        await refresh();
      } catch (cause) {
        setReplayNote(
          cause instanceof Error
            ? `${cause.message} (already processed, in flight, or missing event_id)`
            : 'replay failed',
        );
      } finally {
        setReplayingId(null);
      }
    },
    [refresh],
  );

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
          {entries.map((entry) => {
            const diag = diagnose(entry);
            return (
              <li key={entry.id} className="relative">
                <button
                  type="button"
                  onClick={() => void discard(entry)}
                  title="Discard this dead letter (DELETE /dlq/:id)"
                  aria-label={`Discard dead letter ${entry.eventId ?? entry.id}`}
                  className="absolute right-1 top-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-sm leading-none text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  ×
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(entry.correlationId)}
                  style={{ borderLeftColor: diag.color, borderLeftWidth: 3 }}
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    selectedId === entry.correlationId
                      ? 'border-border-strong bg-surface-2'
                      : 'border-border-subtle hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 pr-5">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: 'var(--surface-2)',
                        color: diag.color,
                      }}
                    >
                      {diag.badge}
                    </span>
                    <AttemptDots attempts={entry.attempts} />
                  </div>
                  <div className="mt-1.5 leading-relaxed text-fg-muted">
                    {diag.summary}
                  </div>
                  <div className="mono mt-1 flex items-center gap-1.5 truncate text-[10px] text-fg-faint">
                    <span className="truncate">
                      {entry.eventId ?? entry.correlationId}
                    </span>
                    <span>· {new Date(entry.createdAt).toLocaleTimeString()}</span>
                    {entry.replayedAt ? (
                      <span
                        className="rounded px-1 py-px font-semibold uppercase"
                        style={{
                          backgroundColor: 'var(--surface-2)',
                          color: 'var(--color-stage-published)',
                        }}
                      >
                        replayed
                      </span>
                    ) : null}
                  </div>
                </button>
                {selectedId === entry.correlationId ? (
                  <div className="mt-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                    <dl className="flex flex-col gap-1">
                      <DetailRow
                        label="event_id"
                        value={entry.eventId ?? '(none)'}
                      />
                      <DetailRow
                        label="message_id"
                        value={entry.messageId ?? '(none)'}
                      />
                      <DetailRow label="raw reason" value={entry.reason} />
                      <DetailRow
                        label="failed_at"
                        value={new Date(entry.createdAt).toLocaleString()}
                      />
                      {entry.replayedAt ? (
                        <DetailRow
                          label="replayed_at"
                          value={new Date(entry.replayedAt).toLocaleString()}
                        />
                      ) : null}
                    </dl>
                    <button
                      type="button"
                      onClick={() => void replay(entry)}
                      disabled={replayingId !== null}
                      aria-busy={replayingId === entry.id}
                      className="mt-2 cursor-pointer rounded-md border border-border-subtle px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:cursor-wait disabled:opacity-60"
                    >
                      {replayingId === entry.id
                        ? 'replaying...'
                        : 'replay via POST /dlq/:id/replay'}
                    </button>
                    <div className="mt-2 text-[10px] uppercase tracking-wider text-fg-faint">
                      payload
                    </div>
                    <pre className="mono mt-1 max-h-40 overflow-auto rounded bg-surface p-2 text-[11px] leading-relaxed">
                      {formatPayload(entry.payload)}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {replayNote ? (
        <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
          {replayNote}
        </p>
      ) : null}
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
