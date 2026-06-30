import { STAGE_META } from '../lib/stages';
import type { Token } from '../state/reducer';
import { Empty, Panel } from './ui';

export function TokenDetail({
  token,
  groupSize,
}: {
  token: Token | null;
  groupSize: number;
}) {
  return (
    <Panel title="Event timeline">
      {!token ? (
        <Empty>Select a token in the pipeline to inspect its journey.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-xs">
            <Row label="correlation_id" value={token.correlationId} color={token.color} />
            <Row label="event_id" value={token.eventId ?? '(none)'} />
            <Row label="event_type" value={token.eventType} />
            {token.eventId && groupSize > 1 ? (
              <span className="mt-1 w-fit rounded bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
                shares event_id with {groupSize - 1} other token
                {groupSize > 2 ? 's' : ''}
              </span>
            ) : null}
          </div>
          <ol className="relative flex flex-col gap-2 border-l border-border-strong pl-4">
            {token.stages.map((event, index) => {
              const meta = STAGE_META[event.stage];
              return (
                <li key={`${event.stage}-${index}`} className="relative">
                  <span
                    className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{meta.label}</span>
                    <span className="mono text-[10px] text-fg-faint">
                      {new Date(event.ts).toLocaleTimeString(undefined, {
                        hour12: false,
                      })}
                      .
                      {String(new Date(event.ts).getMilliseconds()).padStart(
                        3,
                        '0',
                      )}
                    </span>
                  </div>
                  {event.attempts ? (
                    <span className="mono text-[10px] text-fg-faint">
                      attempt {event.attempts}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Panel>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-fg-faint">{label}</span>
      <span className="mono break-all" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
