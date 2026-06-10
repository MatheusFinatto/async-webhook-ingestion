import { Injectable } from '@nestjs/common';

export interface HandledEvent {
  eventId: string;
  eventType: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

export abstract class OrderHandler {
  abstract handle(event: HandledEvent, attempt: number): Promise<void>;
}

@Injectable()
export class NoopOrderHandler extends OrderHandler {
  async handle(): Promise<void> {}
}
