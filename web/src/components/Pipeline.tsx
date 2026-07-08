import { motion, useReducedMotion } from 'framer-motion';
import { STAGE_META, type NodeKey } from '../lib/stages';
import {
  EDGES,
  NODES,
  nodeCenter,
  VIEWBOX_H,
  VIEWBOX_W,
} from '../lib/stages';
import type { Token } from '../state/reducer';

function retryNode(tier: string | undefined): NodeKey {
  if (tier === '30s') {
    return 'retry30s';
  }
  if (tier === '2min') {
    return 'retry2min';
  }
  return 'retry5s';
}

function tokenNode(token: Token): NodeKey {
  if (token.currentStage === 'retry') {
    return retryNode(token.retryTier);
  }
  return STAGE_META[token.currentStage].node;
}

interface PipelineProps {
  tokens: Token[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
}

function tokenColor(token: Token): string {
  return STAGE_META[token.currentStage].color;
}

export function Pipeline({ tokens, selectedId, now, onSelect }: PipelineProps) {
  const reduce = useReducedMotion();

  const seqOf = new Map<string, number>();
  tokens.forEach((token, index) => seqOf.set(token.correlationId, index + 1));

  const grouped = new Map<NodeKey, Token[]>();
  for (const token of tokens) {
    const key = tokenNode(token);
    const list = grouped.get(key) ?? [];
    list.push(token);
    grouped.set(key, list);
  }

  const positions = new Map<
    string,
    { x: number; y: number; token: Token }
  >();
  for (const [key, list] of grouped) {
    const center = nodeCenter(key);
    list.forEach((token, index) => {
      const spread = (index - (list.length - 1) / 2) * 16;
      positions.set(token.correlationId, {
        x: center.x + spread,
        y: center.y - 34,
        token,
      });
    });
  }

  return (
    <div className="flex flex-col gap-2">
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

        {[...positions.values()].map(({ x, y, token }) => {
          const remaining = token.retryDeadline
            ? Math.max(0, Math.ceil((token.retryDeadline - now) / 1000))
            : null;
          return (
            <motion.g
              key={token.correlationId}
              initial={false}
              animate={{ x, y }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 220, damping: 26 }
              }
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(token.correlationId)}
            >
              <circle
                r={selectedId === token.correlationId ? 12 : 9}
                fill={tokenColor(token)}
                stroke={
                  selectedId === token.correlationId
                    ? 'var(--text)'
                    : 'transparent'
                }
                strokeWidth={2}
              />
              {token.terminal ? (
                <circle
                  r={14}
                  fill="none"
                  stroke={tokenColor(token)}
                  strokeWidth={1}
                />
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
              {remaining !== null ? (
                <text
                  y={-16}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize={10}
                  className="mono"
                >
                  {remaining}s
                </text>
              ) : null}
            </motion.g>
          );
        })}
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
