import { useEffect, useMemo, useState } from 'react';
import { ConnectionIndicator, OfflineBanner } from './components/ConnectionBanner';
import { DlqPanel } from './components/DlqPanel';
import { MetricsPanel } from './components/MetricsPanel';
import { Pipeline } from './components/Pipeline';
import { ResponsePanel } from './components/ResponsePanel';
import { ScenarioBar } from './components/ScenarioBar';
import { SignaturePanel } from './components/SignaturePanel';
import { TokenDetail } from './components/TokenDetail';
import type { ScenarioId } from './lib/scenarios';
import { useTheme } from './lib/useTheme';
import { useDemoStore } from './state/useDemoStore';

const EXAMPLE_TIMESTAMP = '1700000000';
const EXAMPLE_BODY = JSON.stringify({
  event_id: 'evt_demo',
  event_type: 'order.created',
  payload: { amount: 4200, currency: 'BRL' },
});

export default function App() {
  const { theme, toggle } = useTheme();
  const {
    state,
    connection,
    unknownVersions,
    runScenario,
    reset,
    notifySettled,
  } = useDemoStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const tokens = useMemo(
    () => state.order.map((id) => state.tokens[id]),
    [state.order, state.tokens],
  );
  const latest = tokens.length > 0 ? tokens[tokens.length - 1] : null;
  const selected = selectedId ? (state.tokens[selectedId] ?? null) : null;

  const groupSize = useMemo(() => {
    if (!selected?.eventId) {
      return 1;
    }
    return tokens.filter((token) => token.eventId === selected.eventId).length;
  }, [selected, tokens]);

  const signed = latest?.rawBody
    ? { timestamp: latest.signedTimestamp ?? '', rawBody: latest.rawBody }
    : { timestamp: EXAMPLE_TIMESTAMP, rawBody: EXAMPLE_BODY };

  const handleRun = async (id: ScenarioId) => {
    setBusy(true);
    try {
      await runScenario(id);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    reset();
    setSelectedId(null);
  };

  const handleSelect = (id: string) =>
    setSelectedId((current) => (current === id ? null : id));

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Webhook Ingestion — Live Demo
          </h1>
          <p className="text-sm text-fg-muted">
            Real events through HMAC → RabbitMQ → idempotent worker → PostgreSQL,
            each stage streamed over WebSocket telemetry.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionIndicator state={connection} />
          <button
            type="button"
            onClick={toggle}
            className="cursor-pointer rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm transition-colors hover:border-border-strong"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <OfflineBanner state={connection} />

      <ScenarioBar onRun={handleRun} onReset={handleReset} busy={busy} />

      <Pipeline
        tokens={tokens}
        selectedId={selectedId}
        now={now}
        onSelect={handleSelect}
        onSettled={notifySettled}
      />
      {tokens.length === 0 ? (
        <p className="text-center text-xs text-fg-faint">
          No events yet. Fire a scenario above to watch it travel the pipeline.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <ResponsePanel token={selected ?? latest} />
        <MetricsPanel counters={state.counters} latencies={state.latencies} />
        <TokenDetail token={selected} groupSize={groupSize} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SignaturePanel timestamp={signed.timestamp} rawBody={signed.rawBody} />
        <DlqPanel
          deadCount={state.counters.dead}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>

      {unknownVersions > 0 ? (
        <p className="text-center text-xs text-fg-faint">
          ignored {unknownVersions} telemetry envelope
          {unknownVersions > 1 ? 's' : ''} of an unsupported version
        </p>
      ) : null}
    </div>
  );
}
