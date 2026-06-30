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

export function Pipeline({ tokens, selectedId, now, onSelect }: PipelineProps) {
  const reduce = useReducedMotion();

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
                r={selectedId === token.correlationId ? 11 : 8}
                fill={token.color}
                stroke={
                  selectedId === token.correlationId
                    ? 'var(--text)'
                    : 'transparent'
                }
                strokeWidth={2}
              />
              {token.terminal ? (
                <circle r={13} fill="none" stroke={token.color} strokeWidth={1} />
              ) : null}
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
  );
}
