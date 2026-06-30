import { SCENARIOS, type ScenarioId } from '../lib/scenarios';

interface ScenarioBarProps {
  onRun: (id: ScenarioId) => void;
  onReset: () => void;
  busy: boolean;
}

export function ScenarioBar({ onRun, onReset, busy }: ScenarioBarProps) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {SCENARIOS.map((scenario) => (
        <button
          key={scenario.id}
          type="button"
          disabled={busy}
          onClick={() => onRun(scenario.id)}
          title={scenario.description}
          className="group flex min-w-[132px] flex-col gap-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong disabled:opacity-60"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{scenario.label}</span>
            <span className="mono rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">
              {scenario.expected}
            </span>
          </span>
          <span className="text-xs text-fg-faint">{scenario.description}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="ml-auto self-start rounded-lg border border-border-subtle px-3 py-2 text-sm text-fg-muted hover:border-border-strong"
      >
        Reset
      </button>
    </div>
  );
}
