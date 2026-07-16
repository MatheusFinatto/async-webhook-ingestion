import { motion } from 'framer-motion';
import { percentile, type Counters } from '../state/reducer';
import { Panel } from './ui';

const COUNTER_META: { key: keyof Counters; label: string; color: string }[] = [
  { key: 'processed', label: 'processed', color: 'var(--color-stage-processed)' },
  { key: 'duplicate', label: 'duplicate', color: 'var(--color-stage-duplicate)' },
  { key: 'retry', label: 'retry', color: 'var(--color-stage-retry)' },
  { key: 'dead', label: 'dead', color: 'var(--color-stage-dead)' },
  { key: 'rejected', label: 'rejected', color: 'var(--color-stage-rejected)' },
];

function format(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)} ms`;
}

export function MetricsPanel({
  counters,
  latencies,
}: {
  counters: Counters;
  latencies: number[];
}) {
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  return (
    <Panel
      title="Live counters"
      info="Running tally of how each event ended up: processed OK, skipped as duplicate, retried, dead-lettered, or rejected. Below, the percentiles show how fast the API returned its 202 acknowledgement (measured in your browser)."
    >
      <div className="grid grid-cols-5 gap-1.5">
        {COUNTER_META.map((meta) => (
          <div
            key={meta.key}
            className="rounded-md border border-border-subtle bg-surface-2 p-1.5 text-center"
          >
            <motion.div
              key={counters[meta.key]}
              initial={{ scale: 0.7, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mono text-xl font-semibold"
              style={{ color: meta.color }}
            >
              {counters[meta.key]}
            </motion.div>
            <div className="text-[10px] text-fg-faint">{meta.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs">
        <div className="font-medium text-fg-muted">202 latency</div>
        <div className="text-[10px] text-fg-faint">client-side</div>
        <div className="mono mt-1.5 flex flex-col gap-0.5 text-fg-muted">
          <span>· p50 {format(p50)}</span>
          <span>· p95 {format(p95)}</span>
          <span>· n {latencies.length}</span>
        </div>
      </div>
    </Panel>
  );
}
