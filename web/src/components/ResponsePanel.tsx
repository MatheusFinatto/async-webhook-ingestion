import { processingMs, type Token } from '../state/reducer';
import { Empty, Panel, StatusBadge } from './ui';

function Timing({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md bg-surface-2 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-fg-faint">
        {label}
      </span>
      <span className="mono text-sm">{value}</span>
    </div>
  );
}

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
}

function formatBody(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

export function ResponsePanel({ token }: { token: Token | null }) {
  return (
    <Panel title="HTTP response">
      {!token || token.httpStatus === undefined ? (
        <Empty>Fire a scenario to see the real HTTP response.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <StatusBadge status={token.httpStatus} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Timing
              label="response"
              value={
                token.latencyMs !== undefined ? formatMs(token.latencyMs) : '—'
              }
            />
            <Timing
              label="processing"
              value={(() => {
                const value = processingMs(token);
                if (value !== null) {
                  return formatMs(value);
                }
                // Only a 202 was ever queued; 4xx/5xx are rejected at the API
                // boundary and never reach the worker, so there is nothing to
                // process; distinguish that from a 202 still in flight.
                return token.httpStatus === 202 ? 'pending' : 'not queued';
              })()}
            />
          </div>
          <div className="mono text-xs text-fg-muted">
            <span className="text-fg-faint">correlation_id</span>{' '}
            <span style={{ color: token.color }}>{token.correlationId}</span>
          </div>
          <pre className="mono max-h-48 overflow-auto rounded-md bg-surface-2 p-3 text-xs leading-relaxed">
            {formatBody(token.httpBody)}
          </pre>
        </div>
      )}
    </Panel>
  );
}
