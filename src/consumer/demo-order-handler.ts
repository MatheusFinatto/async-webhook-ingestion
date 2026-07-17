import { Injectable } from '@nestjs/common';
import { HandledEvent, OrderHandler } from './order-handler';
import {
  PermanentProcessingError,
  TransientProcessingError,
} from './processing-errors';

export const DEMO_SCENARIO_KEY = '__scenario';

export const OUTAGE_UNTIL_KEY = '__outage_until';

export const TRANSIENT_SUCCESS_ATTEMPT = 3;

export type DemoScenario = 'transient' | 'permanent' | 'exhaust';

function scenarioOf(event: HandledEvent): DemoScenario | null {
  const value = event.payload[DEMO_SCENARIO_KEY];
  if (value === 'transient' || value === 'permanent' || value === 'exhaust') {
    return value;
  }
  return null;
}

@Injectable()
export class DemoOrderHandler extends OrderHandler {
  async handle(event: HandledEvent, attempt: number): Promise<void> {
    const scenario = scenarioOf(event);
    if (scenario === 'permanent') {
      throw new PermanentProcessingError(
        `demo scenario "permanent" for ${event.eventId}`,
      );
    }
    if (scenario === 'exhaust') {
      const outageUntil = Number(event.payload[OUTAGE_UNTIL_KEY]);
      if (!Number.isFinite(outageUntil) || Date.now() < outageUntil) {
        throw new TransientProcessingError(
          `demo scenario "exhaust" failing attempt ${attempt} for ${event.eventId}`,
        );
      }
      return;
    }
    if (scenario === 'transient' && attempt < TRANSIENT_SUCCESS_ATTEMPT) {
      throw new TransientProcessingError(
        `demo scenario "transient" failing attempt ${attempt} for ${event.eventId}`,
      );
    }
  }
}
