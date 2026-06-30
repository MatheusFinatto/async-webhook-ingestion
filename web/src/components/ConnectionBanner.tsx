import type { ConnectionState } from '../lib/socket';

const LABELS: Record<ConnectionState, string> = {
  connecting: 'connecting to telemetry feed…',
  connected: 'live',
  disconnected: 'backend offline',
};

const COLORS: Record<ConnectionState, string> = {
  connecting: 'var(--color-stage-consuming)',
  connected: 'var(--color-stage-processed)',
  disconnected: 'var(--color-stage-dead)',
};

export function ConnectionIndicator({ state }: { state: ConnectionState }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: COLORS[state] }}
      />
      <span className="mono">{LABELS[state]}</span>
    </span>
  );
}

export function OfflineBanner({ state }: { state: ConnectionState }) {
  if (state !== 'disconnected') {
    return null;
  }
  return (
    <div
      role="status"
      className="rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm"
    >
      <span className="font-medium" style={{ color: 'var(--color-stage-dead)' }}>
        Backend offline.
      </span>{' '}
      <span className="text-fg-muted">
        Start it with{' '}
        <code className="mono rounded bg-surface-2 px-1.5 py-0.5 text-xs">
          docker compose -f docker-compose.yml -f docker-compose.demo.yml up
        </code>
        . Scenario triggers still run over HTTP, but the pipeline stops animating
        until the feed returns.
      </span>
    </div>
  );
}
