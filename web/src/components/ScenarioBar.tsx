import { SCENARIOS, type ScenarioId } from '../lib/scenarios';
import { statusColor } from '../lib/status';

export function ScenarioBar({ onRun, onReset, busy }: ScenarioBarProps) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {SCENARIOS.map((scenario) => {
        const code = parseInt(scenario.expected, 10);
        const accent = statusColor(Number.isNaN(code) ? 0 : code);
        return (
          <button
            key={scenario.id}
            type="button"
            disabled={busy}
            onClick={() => onRun(scenario.id)}
            title={scenario.description}
            style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
            className="group flex w-[184px] cursor-pointer flex-col gap-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{scenario.label}</span>
              <span
                className="mono rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: 'var(--surface-2)', color: accent }}
              >
                {scenario.expected}
              </span>
            </span>
            <span className="text-xs text-fg-faint">{scenario.description}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onReset}
        className="ml-auto self-start cursor-pointer rounded-lg border border-border-subtle px-3 py-2 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        Reset
      </button>
    </div>
  );
}

interface ScenarioBarProps {
  onRun: (id: ScenarioId) => void;
  onReset: () => void;
  busy: boolean;
}
