import type { Token } from '../state/reducer';
import { Empty, Panel, StatusBadge } from './ui';

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
            <span className="mono text-xs text-fg-muted">
              {token.latencyMs !== undefined
                ? `${token.latencyMs.toFixed(1)} ms`
                : ''}
            </span>
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
