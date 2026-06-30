import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { trigger } from '../lib/api';
import { SCENARIOS, type ScenarioId } from '../lib/scenarios';
import {
  createTelemetrySocket,
  type ConnectionState,
  type TelemetrySocket,
} from '../lib/socket';
import { initialState, reducer } from './reducer';

export interface DemoStore {
  state: ReturnType<typeof reducer>;
  connection: ConnectionState;
  unknownVersions: number;
  runScenario: (id: ScenarioId) => Promise<void>;
  reset: () => void;
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

  const runScenario = useCallback(async (id: ScenarioId) => {
    const scenario = SCENARIOS.find((entry) => entry.id === id);
    if (!scenario) {
      return;
    }
    const specs = scenario.build();
    await Promise.all(
      specs.map(async (spec) => {
        socketRef.current?.subscribe(spec.correlationId);
        dispatch({
          type: 'trigger_started',
          correlationId: spec.correlationId,
          eventId: spec.eventId,
          eventType: spec.eventType,
          scenario: scenario.id,
          label: spec.label,
          ts: new Date().toISOString(),
        });
        try {
          const result = await trigger(spec);
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
      }),
    );
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { state, connection, unknownVersions, runScenario, reset };
}
