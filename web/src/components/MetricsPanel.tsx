import { motion } from 'framer-motion';
import { percentile, type Counters } from '../state/reducer';
import { Panel } from './ui';

const COUNTER_META: { key: keyof Counters; label: string; color: string }[] = [
  { key: 'processed', label: 'processed', color: 'var(--color-stage-processed)' },
  { key: 'duplicate', label: 'duplicate', color: 'var(--color-stage-duplicate)' },
  { key: 'retry', label: 'retry', color: 'var(--color-stage-retry)' },
  { key: 'dead', label: 'dead', color: 'var(--color-stage-dead)' },
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
    <Panel title="Live counters">
      <div className="grid grid-cols-4 gap-2">
        {COUNTER_META.map((meta) => (
          <div
            key={meta.key}
            className="rounded-md border border-border-subtle bg-surface-2 p-2 text-center"
          >
            <motion.div
              key={counters[meta.key]}
              initial={{ scale: 0.7, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mono text-2xl font-semibold"
              style={{ color: meta.color }}
            >
              {counters[meta.key]}
            </motion.div>
            <div className="text-[11px] text-fg-faint">{meta.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-xs">
        <span className="text-fg-faint">
          202 latency
          <span className="ml-1 rounded bg-surface px-1 py-0.5 text-[10px]">
            client-side
          </span>
        </span>
        <span className="mono">
          p50 {format(p50)} · p95 {format(p95)} · n {latencies.length}
        </span>
      </div>
    </Panel>
  );
}
