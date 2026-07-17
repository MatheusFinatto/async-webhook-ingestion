export const TELEMETRY_VERSION = 1;

export type WorkerStage =
  | 'consuming'
  | 'processing_decision'
  | 'processed'
  | 'duplicate'
  | 'retry'
  | 'dead';

export type ApiStage =
  | 'received'
  | 'signature_verified'
  | 'published'
  | 'injected'
  | 'rejected'
  | 'malformed'
  | 'unavailable';

export type Stage = ApiStage | WorkerStage;

export interface TelemetryEnvelope {
  version: number;
  stage: WorkerStage;
  correlation_id: string;
  event_id: string | null;
  event_type: string;
  status: string;
  attempts: number;
  ts: string;
}

export const STAGE_RANK: Record<Stage, number> = {
  received: 0,
  signature_verified: 1,
  malformed: 1,
  rejected: 1,
  published: 2,
  injected: 2,
  unavailable: 2,
  consuming: 3,
  processing_decision: 4,
  retry: 5,
  processed: 6,
  duplicate: 6,
  dead: 6,
};

export const TERMINAL_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  'processed',
  'duplicate',
  'dead',
  'rejected',
  'malformed',
  'unavailable',
]);

export function isTerminal(stage: Stage): boolean {
  return TERMINAL_STAGES.has(stage);
}

const WORKER_STAGES: ReadonlySet<string> = new Set<WorkerStage>([
  'consuming',
  'processing_decision',
  'processed',
  'duplicate',
  'retry',
  'dead',
]);

export function isTelemetryEnvelope(value: unknown): value is TelemetryEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.stage === 'string' &&
    WORKER_STAGES.has(candidate.stage) &&
    typeof candidate.correlation_id === 'string' &&
    typeof candidate.event_type === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.attempts === 'number' &&
    typeof candidate.ts === 'string'
  );
}

export function isSupportedVersion(envelope: TelemetryEnvelope): boolean {
  return envelope.version === TELEMETRY_VERSION;
}
