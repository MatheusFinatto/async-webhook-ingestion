import { SCENARIOS, type ScenarioId, type StoryTone } from '../lib/scenarios';
import { statusColor } from '../lib/status';
import { InfoTip } from './ui';

const TONE_COLOR: Record<StoryTone, string> = {
  info: 'var(--text-faint)',
  ok: 'var(--color-stage-processed)',
  retry: 'var(--color-stage-retry)',
  fail: 'var(--color-stage-dead)',
};

export function ScenarioBar({ onRun, onReset, busy }: ScenarioBarProps) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {SCENARIOS.map((scenario, index) => {
        const code = parseInt(scenario.expected, 10);
        const accent = statusColor(Number.isNaN(code) ? 0 : code);
        return (
          <div key={scenario.id} className="relative">
            <button
              type="button"
              disabled={busy}
              onClick={() => onRun(scenario.id)}
              title={scenario.description}
              style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
              className="group flex h-full w-[184px] cursor-pointer flex-col gap-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
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
              <span className="text-xs text-fg-faint">
                {scenario.description}
              </span>
            </button>
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-surface">
              <InfoTip
                align={index === 0 ? 'left' : 'right'}
                label={scenario.label}
                text={
                  <span className="flex flex-col gap-1.5">
                    {scenario.story.map((step) => (
                      <span key={step.text} className="flex items-start gap-2">
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: TONE_COLOR[step.tone] }}
                        />
                        <span>{step.text}</span>
                      </span>
                    ))}
                  </span>
                }
              />
            </span>
          </div>
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
