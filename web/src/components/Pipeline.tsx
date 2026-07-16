import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { STAGE_META, type NodeKey } from '../lib/stages';
import { EDGES, NODES, nodeCenter, VIEWBOX_H, VIEWBOX_W } from '../lib/stages';
import { retryTier, type StageEvent, type Token } from '../state/reducer';

// Slow-demo pacing. The walk is a scripted timeline, not tied to when telemetry
// actually arrived: TICK_MS is how often we re-evaluate, HOP_MS is how long the
// ball dwells on a normal box before stepping on, and retry boxes hold for their
// tier duration below so the stopwatch visibly climbs to 5s / 30s / 2min.
const TICK_MS = 200;
const HOP_MS = 750;

function retryNode(tier: string | undefined): NodeKey {
  if (tier === '30s') {
    return 'retry30s';
  }
  if (tier === '2min') {
    return 'retry2min';
  }
  return 'retry5s';
}

// Nominal TTL each retry box represents. In slow demo the walk holds the token
// in the box for this long, so the stopwatch climbs to the real tier duration
// instead of the walk skipping ahead the moment the next attempt's telemetry
// has already landed.
const RETRY_BOX_MS: Partial<Record<NodeKey, number>> = {
  retry5s: 5_000,
  retry30s: 30_000,
  retry2min: 120_000,
};

// The infra boxes on the main row have no telemetry stage of their own, so a
// stage-derived path would fly straight over them. Fill them back in when the
// walk crosses a gap along this row.
const MAIN_ROW: NodeKey[] = [
  'post',
  'guard',
  'validate',
  'exchange',
  'work',
  'worker',
  'postgres',
];

function mainIndex(node: NodeKey): number {
  return MAIN_ROW.indexOf(node);
}

interface PathStep {
  node: NodeKey;
  color: string;
  caption: string;
}

const INFRA_CAPTION: Partial<Record<NodeKey, string>> = {
  guard: 'HMAC-SHA256 signature accepted',
  validate: 'schema valid → forwarded',
  work: 'queued for the worker',
};

function infraCaption(token: Token, node: NodeKey): string {
  if (token.httpStatus === 0) {
    return '';
  }
  return INFRA_CAPTION[node] ?? '';
}

function rejectionCaption(token: Token): string {
  const body = token.httpBody as { message?: unknown } | undefined;
  const message = typeof body?.message === 'string' ? body.message : '';
  if (message.includes('timestamp')) {
    return 'timestamp outside accepted window → 401';
  }
  if (message.includes('signature')) {
    return 'HMAC-SHA256 signature mismatch → 401';
  }
  return 'rejected by the HMAC guard → 401';
}

function captionFor(token: Token, event: StageEvent): string {
  switch (event.stage) {
    case 'received':
      return 'signed POST /orders sent';
    case 'signature_verified':
      return 'HMAC-SHA256 signature accepted';
    case 'rejected':
      return rejectionCaption(token);
    case 'malformed':
      return 'schema rejected: missing event_id → 400';
    case 'published':
      return 'published to the webhooks exchange';
    case 'unavailable':
      return 'broker unreachable → 503';
    case 'consuming':
      return 'worker consumed the message';
    case 'processing_decision':
      return 'checking event_id in PostgreSQL';
    case 'processed':
      return 'event_id is new → inserted in PostgreSQL';
    case 'duplicate':
      return 'event_id already in PostgreSQL → discarded';
    case 'retry':
      return `attempt ${event.attempts ?? 1} failed → retry in ${retryTier(event.attempts ?? 1)}`;
    case 'dead':
      return 'permanent failure → dead-lettered';
    default:
      return '';
  }
}

// The ordered nodes a token walks, each tagged with the colour to paint the ball
// while it sits there. Derived from the stage history (rank-sorted upstream):
// each retry attempt maps to its own tier box, so the path carries the
// 5s->30s->2min ladder without relying on mutable token fields a mid-ladder
// envelope could reset. Skipped main-row boxes (validation, work queue) are
// spliced back in, and a successful reprocess after a retry passes back through
// the worker before PostgreSQL. Colour matters for the slow walk: the ball must
// stay the retry colour until it visually reaches the outcome box, rather than
// snapping green the instant the backend reports 'processed'.
function pathOf(token: Token): PathStep[] {
  const path: PathStep[] = [];
  const tail = () => path[path.length - 1];
  const inherited = () => tail()?.color ?? STAGE_META.received.color;
  for (const event of token.stages) {
    const node =
      event.stage === 'retry'
        ? retryNode(retryTier(event.attempts ?? 1))
        : STAGE_META[event.stage].node;
    const color = STAGE_META[event.stage].color;
    const caption = captionFor(token, event);
    const prev = tail()?.node;
    if (prev === node) {
      // Same box, a later stage (e.g. consuming -> processing on the worker):
      // keep one step but adopt the newer colour.
      tail().color = color;
      tail().caption = caption;
      continue;
    }
    const from = prev ? mainIndex(prev) : -1;
    const to = mainIndex(node);
    if (from !== -1 && to > from + 1) {
      for (let k = from + 1; k < to; k += 1) {
        path.push({
          node: MAIN_ROW[k],
          color: inherited(),
          caption: infraCaption(token, MAIN_ROW[k]),
        });
      }
    } else if (prev?.startsWith('retry') && node === 'postgres') {
      path.push({
        node: 'worker',
        color: inherited(),
        caption: 'redelivered → reprocessing',
      });
    }
    path.push({ node, color, caption });
  }
  return path.length > 0
    ? path
    : [
        {
          node: 'post',
          color: STAGE_META.received.color,
          caption: captionFor(token, { stage: 'received', ts: '' }),
        },
      ];
}

interface PipelineProps {
  tokens: Token[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
  onSettled?: (correlationId: string) => void;
}

function tokenColor(token: Token): string {
  return STAGE_META[token.currentStage].color;
}

export function Pipeline({
  tokens,
  selectedId,
  now,
  onSelect,
  onSettled,
}: PipelineProps) {
  const reduce = useReducedMotion();

  // Slow-demo walk position per token: which pathOf() index is shown, plus the
  // wall-clock time the ball entered it. Both the step gate and the retry
  // stopwatch read `at`, so the timer and the dwell can never disagree.
  const [walk, setWalk] = useState<
    Record<string, { index: number; at: number }>
  >({});
  // Slow demo walk vs. real-time: real-time snaps each token to its current
  // stage so the pipeline tracks the backend as fast as telemetry arrives.
  const [slow, setSlow] = useState(true);
  const paced = slow && !reduce;

  // Real-time only: stamp when the ball lands in a retry box so its stopwatch
  // counts from arrival. Slow demo uses walk[].at instead.
  const retryArrival = useRef<Record<string, { node: NodeKey; at: number }>>(
    {},
  );

  useEffect(() => {
    if (!paced) {
      return;
    }
    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      setWalk((prev) => {
        let next = prev;
        for (const token of tokens) {
          const path = pathOf(token);
          const target = path.length - 1;
          const entry = prev[token.correlationId] ?? { index: 0, at: nowMs };
          let index = Math.min(entry.index, target);
          let at = entry.at;
          if (index < target) {
            const dwellMs = RETRY_BOX_MS[path[index].node] ?? HOP_MS;
            if (nowMs - at >= dwellMs) {
              index += 1;
              at = nowMs;
            }
          }
          if (
            !(token.correlationId in prev) ||
            index !== entry.index ||
            at !== entry.at
          ) {
            if (next === prev) {
              next = { ...prev };
            }
            next[token.correlationId] = { index, at };
          }
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [tokens, paced]);

  const seqOf = new Map<string, number>();
  tokens.forEach((token, index) => seqOf.set(token.correlationId, index + 1));

  const grouped = new Map<NodeKey, Token[]>();
  const visual = new Map<
    string,
    { node: NodeKey; color: string; caption: string; atEnd: boolean }
  >();
  for (const token of tokens) {
    const path = pathOf(token);
    const index = paced
      ? Math.min(walk[token.correlationId]?.index ?? 0, path.length - 1)
      : path.length - 1;
    const step = path[index];
    const key = step.node;
    visual.set(token.correlationId, {
      node: key,
      color: step.color,
      caption: step.caption,
      atEnd: index === path.length - 1,
    });
    if (!paced && key.startsWith('retry')) {
      const arrived = retryArrival.current[token.correlationId];
      if (!arrived || arrived.node !== key) {
        retryArrival.current[token.correlationId] = { node: key, at: now };
      }
    }
    const list = grouped.get(key) ?? [];
    list.push(token);
    grouped.set(key, list);
  }

  const positions = new Map<
    string,
    {
      x: number;
      y: number;
      token: Token;
      node: NodeKey;
      color: string;
      caption: string;
      captionRow: number;
      atEnd: boolean;
    }
  >();
  for (const [key, list] of grouped) {
    const center = nodeCenter(key);
    list.forEach((token, index) => {
      const spread = (index - (list.length - 1) / 2) * 16;
      const info = visual.get(token.correlationId)!;
      positions.set(token.correlationId, {
        x: center.x + spread,
        y: center.y - 34,
        token,
        node: key,
        color: info.color,
        caption: info.caption,
        captionRow: index,
        atEnd: info.atEnd,
      });
    });
  }

  const settledRef = useRef<Map<string, number>>(new Map());
  const settledNow = tokens
    .filter((token) => {
      const info = visual.get(token.correlationId);
      return (
        token.terminal &&
        info?.atEnd === true &&
        !settledRef.current.has(token.correlationId)
      );
    })
    .map((token) => token.correlationId);
  useEffect(() => {
    for (const id of settledNow) {
      settledRef.current.set(id, Date.now());
      onSettled?.(id);
    }
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2 text-xs">
        <span className="text-fg-faint">Playback</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border-subtle">
          {[
            { value: true, label: 'Slow demo' },
            { value: false, label: 'Real-time' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setSlow(option.value)}
              className={`cursor-pointer px-2.5 py-1 transition-colors ${
                slow === option.value
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-faint hover:text-fg'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface p-2">
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="w-full min-w-[860px]"
          role="img"
          aria-label="Webhook ingestion pipeline"
        >
          {EDGES.map((edge) => {
            const from = nodeCenter(edge.from);
            const to = nodeCenter(edge.to);
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--border-strong)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            );
          })}

          {NODES.map((node) => (
            <g key={node.key}>
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={8}
                fill="var(--surface-2)"
                stroke="var(--border-strong)"
              />
              <text
                x={node.x + node.w / 2}
                y={node.y + node.h / 2 - 2}
                textAnchor="middle"
                fill="var(--text)"
                fontSize={12}
                fontWeight={600}
              >
                {node.label}
              </text>
              {node.sub ? (
                <text
                  x={node.x + node.w / 2}
                  y={node.y + node.h / 2 + 13}
                  textAnchor="middle"
                  fill="var(--text-faint)"
                  fontSize={9}
                >
                  {node.sub}
                </text>
              ) : null}
            </g>
          ))}

          {[...positions.values()].map(
            ({ x, y, token, node, color, caption, captionRow, atEnd }) => {
              const realtimeArrival = retryArrival.current[token.correlationId];
              let arrivedAt: number | undefined;
              if (paced) {
                arrivedAt = walk[token.correlationId]?.at;
              } else if (realtimeArrival?.node === node) {
                arrivedAt = realtimeArrival.at;
              }
              const elapsed =
                node.startsWith('retry') && arrivedAt !== undefined
                  ? Math.max(0, Math.floor((now - arrivedAt) / 1000))
                  : null;
              const captionHalfW = caption.length * 2.7;
              const captionX =
                Math.min(
                  Math.max(x, captionHalfW + 6),
                  VIEWBOX_W - captionHalfW - 6,
                ) - x;
              const captionY = -30 - captionRow * 11;
              return (
                <motion.g
                  key={token.correlationId}
                  initial={false}
                  animate={{ x, y }}
                  transition={
                    paced
                      ? { type: 'tween', duration: 0.55, ease: 'easeInOut' }
                      : { type: 'tween', duration: 0.18, ease: 'easeOut' }
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(token.correlationId)}
                >
                  <circle
                    r={selectedId === token.correlationId ? 12 : 9}
                    fill={color}
                    stroke={
                      selectedId === token.correlationId
                        ? 'var(--text)'
                        : 'transparent'
                    }
                    strokeWidth={2}
                  />
                  {token.terminal && atEnd ? (
                    <circle r={14} fill="none" stroke={color} strokeWidth={1} />
                  ) : null}
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#0b0f1a"
                    fontSize={10}
                    fontWeight={700}
                    style={{ pointerEvents: 'none' }}
                    className="mono"
                  >
                    {seqOf.get(token.correlationId)}
                  </text>
                  {elapsed !== null ? (
                    <text
                      y={-17}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize={10}
                      className="mono"
                    >
                      ⏱ {elapsed}s
                    </text>
                  ) : null}
                  {caption ? (
                    <text
                      x={captionX}
                      y={captionY}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize={12}
                      style={{
                        pointerEvents: 'none',
                        paintOrder: 'stroke',
                        stroke: 'var(--surface)',
                        strokeWidth: 3,
                      }}
                    >
                      {caption}
                    </text>
                  ) : null}
                </motion.g>
              );
            },
          )}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs">
        {tokens.map((token, index) => {
          const color = tokenColor(token);
          const isSelected = selectedId === token.correlationId;
          return (
            <button
              key={token.correlationId}
              type="button"
              onClick={() => onSelect(token.correlationId)}
              className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-surface-2 ${
                isSelected ? 'bg-surface-2' : ''
              }`}
            >
              <span
                className="mono inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ backgroundColor: color, color: '#0b0f1a' }}
              >
                {index + 1}
              </span>
              <span className="text-fg">{token.label}</span>
              <span className="text-fg-faint">
                {STAGE_META[token.currentStage].label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
