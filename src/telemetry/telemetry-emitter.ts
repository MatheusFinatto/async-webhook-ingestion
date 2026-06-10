import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  TELEMETRY_ENVELOPE_VERSION,
  TELEMETRY_EXCHANGE,
  telemetryRoutingKey,
} from '../messaging/messaging.constants';

export type TelemetryStage =
  | 'consuming'
  | 'processing_decision'
  | 'processed'
  | 'duplicate'
  | 'retry'
  | 'dead';

export interface TelemetryStageInput {
  stage: TelemetryStage;
  correlationId: string;
  eventId: string | null;
  eventType: string;
  status: string;
  attempts: number;
}

export interface TelemetryEnvelope {
  version: number;
  stage: TelemetryStage;
  correlation_id: string;
  event_id: string | null;
  event_type: string;
  status: string;
  attempts: number;
  ts: string;
}

export abstract class TelemetryEmitter {
  abstract emit(input: TelemetryStageInput): void;
}

@Injectable()
export class NoopTelemetryEmitter extends TelemetryEmitter {
  emit(): void {}
}

@Injectable()
export class AmqpTelemetryEmitter extends TelemetryEmitter {
  private readonly logger = new Logger(AmqpTelemetryEmitter.name);

  constructor(private readonly amqp: AmqpConnection) {
    super();
  }

  emit(input: TelemetryStageInput): void {
    const envelope: TelemetryEnvelope = {
      version: TELEMETRY_ENVELOPE_VERSION,
      stage: input.stage,
      correlation_id: input.correlationId,
      event_id: input.eventId,
      event_type: input.eventType,
      status: input.status,
      attempts: input.attempts,
      ts: new Date().toISOString(),
    };
    try {
      void this.amqp
        .publish(TELEMETRY_EXCHANGE, telemetryRoutingKey(input.stage), envelope)
        .catch((error) => this.swallow(error));
    } catch (error) {
      this.swallow(error);
    }
  }

  private swallow(error: unknown): void {
    this.logger.debug({
      message: 'telemetry publish failed',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
