import type { ReactNode } from 'react';
import { STAGE_META } from '../lib/stages';
import { statusColor } from '../lib/status';
import type { Stage } from '../lib/telemetry';

export function Panel({
  title,
  info,
  action,
  children,
}: {
  title: string;
  info?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border-subtle bg-surface">
      <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {title}
          </h2>
          {info ? <InfoTip label={title} text={info} /> : null}
        </div>
        {action}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

export function InfoTip({
  label,
  text,
  align = 'left',
}: {
  label: string;
  text: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={`What does "${label}" mean?`}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border-subtle text-[10px] font-semibold leading-none text-fg-faint transition-colors hover:border-border-strong hover:text-fg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-20 mt-2 hidden w-60 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-fg-muted shadow-lg group-hover:block group-focus-within:block ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {text}
      </span>
    </span>
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
