import type { Stage } from './telemetry';

export interface StageMeta {
  label: string;
  color: string;
  node: NodeKey;
}

export type NodeKey =
  | 'post'
  | 'guard'
  | 'validate'
  | 'exchange'
  | 'work'
  | 'worker'
  | 'postgres'
  | 'retry5s'
  | 'retry30s'
  | 'retry2min'
  | 'dlq';

export const STAGE_META: Record<Stage, StageMeta> = {
  received: {
    label: 'received',
    color: 'var(--color-stage-received)',
    node: 'post',
  },
  signature_verified: {
    label: 'signature verified',
    color: 'var(--color-stage-signature)',
    node: 'guard',
  },
  rejected: {
    label: 'rejected (401)',
    color: 'var(--color-stage-rejected)',
    node: 'guard',
  },
  malformed: {
    label: 'malformed (400)',
    color: 'var(--color-stage-malformed)',
    node: 'validate',
  },
  published: {
    label: 'published',
    color: 'var(--color-stage-published)',
    node: 'exchange',
  },
  unavailable: {
    label: 'unavailable (503)',
    color: 'var(--color-stage-unavailable)',
    node: 'exchange',
  },
  consuming: {
    label: 'consuming',
    color: 'var(--color-stage-consuming)',
    node: 'worker',
  },
  processing_decision: {
    label: 'processing',
    color: 'var(--color-stage-decision)',
    node: 'worker',
  },
  processed: {
    label: 'processed',
    color: 'var(--color-stage-processed)',
    node: 'postgres',
  },
  duplicate: {
    label: 'duplicate',
    color: 'var(--color-stage-duplicate)',
    node: 'postgres',
  },
  retry: {
    label: 'retry',
    color: 'var(--color-stage-retry)',
    node: 'retry5s',
  },
  dead: {
    label: 'dead-lettered',
    color: 'var(--color-stage-dead)',
    node: 'dlq',
  },
};

export interface NodeSpec {
  key: NodeKey;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NODE_W = 116;
export const NODE_H = 56;

export const NODES: NodeSpec[] = [
  { key: 'post', label: 'POST /orders', sub: 'HTTP', x: 24, y: 92, w: NODE_W, h: NODE_H },
  { key: 'guard', label: 'HMAC guard', sub: 'SHA-256', x: 176, y: 92, w: NODE_W, h: NODE_H },
  { key: 'validate', label: 'validation', sub: 'DTO pipe', x: 328, y: 92, w: NODE_W, h: NODE_H },
  { key: 'exchange', label: 'exchange', sub: 'webhooks', x: 480, y: 92, w: NODE_W, h: NODE_H },
  { key: 'work', label: 'work queue', sub: 'orders', x: 632, y: 92, w: NODE_W, h: NODE_H },
  { key: 'worker', label: 'worker', sub: 'idempotent', x: 784, y: 92, w: NODE_W, h: NODE_H },
  { key: 'postgres', label: 'PostgreSQL', sub: 'events', x: 936, y: 92, w: NODE_W, h: NODE_H },
  { key: 'retry5s', label: 'retry 5s', sub: 'TTL+DLX', x: 588, y: 208, w: 96, h: 44 },
  { key: 'retry30s', label: 'retry 30s', sub: 'TTL+DLX', x: 704, y: 208, w: 96, h: 44 },
  { key: 'retry2min', label: 'retry 2min', sub: 'TTL+DLX', x: 820, y: 208, w: 96, h: 44 },
  { key: 'dlq', label: 'DLQ', sub: 'dlq_messages', x: 936, y: 208, w: NODE_W, h: 44 },
];

export const NODE_INDEX: Record<NodeKey, NodeSpec> = NODES.reduce(
  (index, node) => {
    index[node.key] = node;
    return index;
  },
  {} as Record<NodeKey, NodeSpec>,
);

export function nodeCenter(key: NodeKey): { x: number; y: number } {
  const node = NODE_INDEX[key];
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

export interface Edge {
  from: NodeKey;
  to: NodeKey;
}

export const EDGES: Edge[] = [
  { from: 'post', to: 'guard' },
  { from: 'guard', to: 'validate' },
  { from: 'validate', to: 'exchange' },
  { from: 'exchange', to: 'work' },
  { from: 'work', to: 'worker' },
  { from: 'worker', to: 'postgres' },
  { from: 'worker', to: 'retry5s' },
  { from: 'retry5s', to: 'retry30s' },
  { from: 'retry30s', to: 'retry2min' },
  { from: 'worker', to: 'dlq' },
];

export const VIEWBOX_W = 1076;
export const VIEWBOX_H = 284;
