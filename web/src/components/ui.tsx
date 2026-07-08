import type { ReactNode } from 'react';
import { STAGE_META } from '../lib/stages';
import { statusColor } from '../lib/status';
import type { Stage } from '../lib/telemetry';

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border-subtle bg-surface">
      <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h2>
        {action}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

export function StageDot({ stage }: { stage: Stage }) {
  const meta = STAGE_META[stage];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      <span className="text-xs">{meta.label}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: number }) {
  const color = statusColor(status);
  return (
    <span
      className="mono rounded px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: 'var(--surface-2)', color }}
    >
      {status === 0 ? 'no response' : status}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-fg-faint">{children}</p>
  );
}
