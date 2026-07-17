import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { injectPoison, trigger } from '../lib/api';
import { SCENARIOS, type ScenarioId, type TriggerSpec } from '../lib/scenarios';
import {
  createTelemetrySocket,
  type ConnectionState,
  type TelemetrySocket,
} from '../lib/socket';
import { initialState, reducer } from './reducer';

const SETTLE_TIMEOUT_MS = 15_000;

export interface DemoStore {
  state: ReturnType<typeof reducer>;
  connection: ConnectionState;
  unknownVersions: number;
  runScenario: (id: ScenarioId) => Promise<void>;
  reset: () => void;
  notifySettled: (correlationId: string) => void;
}

export function useDemoStore(): DemoStore {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [unknownVersions, setUnknownVersions] = useState(0);
  const socketRef = useRef<TelemetrySocket | null>(null);

  useEffect(() => {
    const socket = createTelemetrySocket({
      onEnvelope: (envelope) =>
        dispatch({ type: 'envelope', envelope, now: Date.now() }),
      onUnknownVersion: () => setUnknownVersions((count) => count + 1),
      onState: setConnection,
    });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const settleWaiters = useRef<Map<string, () => void>>(new Map());
  const runGeneration = useRef(0);

  const notifySettled = useCallback((correlationId: string) => {
    const resolve = settleWaiters.current.get(correlationId);
    if (resolve) {
      settleWaiters.current.delete(correlationId);
      resolve();
    }
  }, []);

  const waitForSettle = useCallback((correlationId: string) => {
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        settleWaiters.current.delete(correlationId);
        resolve();
      }, SETTLE_TIMEOUT_MS);
      settleWaiters.current.set(correlationId, () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }, []);

  const runScenario = useCallback(
    async (id: ScenarioId) => {
      const scenario = SCENARIOS.find((entry) => entry.id === id);
      if (!scenario) {
        return;
      }
      const specs = scenario.build();
      const fire = async (spec: TriggerSpec) => {
        dispatch({
          type: 'trigger_started',
          correlationId: spec.correlationId,
          eventId: spec.eventId,
          eventType: spec.eventType,
          scenario: scenario.id,
          label: spec.label,
          ts: new Date().toISOString(),
          initialStage: scenario.inject ? 'injected' : 'received',
        });
        try {
          const result = scenario.inject
            ? await injectPoison(spec)
            : await trigger(spec);
          dispatch({ type: 'http_result', scenario: scenario.id, result });
        } catch {
          dispatch({
            type: 'http_result',
            scenario: scenario.id,
            result: {
              correlationId: spec.correlationId,
              eventId: spec.eventId,
              eventType: spec.eventType,
              status: 0,
              ok: false,
              bodyText: '',
              body: { error: 'network error. Is the backend up?' },
              latencyMs: 0,
              signed: {
                timestamp: '',
                rawBody: '',
                canonical: '',
                signature: '',
              },
              apiStage: 'unavailable',
              respondedCorrelationId: null,
            },
          });
        }
      };
      if (scenario.sequential) {
        const generation = runGeneration.current;
        for (let index = 0; index < specs.length; index += 1) {
          const settled =
            index < specs.length - 1
              ? waitForSettle(specs[index].correlationId)
              : null;
          await fire(specs[index]);
          if (settled) {
            await settled;
          }
          if (runGeneration.current !== generation) {
            return;
          }
        }
        return;
      }
      await Promise.all(specs.map(fire));
    },
    [waitForSettle],
  );

  const reset = useCallback(() => {
    runGeneration.current += 1;
    for (const resolve of [...settleWaiters.current.values()]) {
      resolve();
    }
    settleWaiters.current.clear();
    dispatch({ type: 'reset' });
  }, []);

  return {
    state,
    connection,
    unknownVersions,
    runScenario,
    reset,
    notifySettled,
  };
}
