// The PodVoice calls the React screens make. One implementation is registered at a time: in the live screen the
// connection owner (podvoice-transport.js, which signs each request into its read generation and diagnostics) is
// registered by the shell when it connects; tests register a plain fetch client against MSW.
import {create} from 'zustand';
import {ACTION_HEADERS, apiBase, endpointUrl} from './paths';
import type {Snapshot} from './schemas';
import {readTimerReceipt, timerActionBody, unknownReceipt} from './timer-actions';
import type {TimerReceipt, TimerRequest} from './timer-actions';

export interface WeatherAdviceBinding {
  availability: unknown;
  bootId: unknown;
  roomId: unknown;
  weatherKey: unknown;
}

// The connection owner's client diagnostics (podvoice-transport.js): rows are recorded only while the read
// generation they began in is current and access is not blocked.
export interface ApiDiagnostics {
  generation: () => number;
  blocked: () => boolean;
  record: (stage: string, fields: Record<string, unknown>) => void;
}

export interface PodVoiceApi {
  diagnostics?: ApiDiagnostics;
  timerAction: (request: TimerRequest & {requestId: string}) => Promise<TimerReceipt>;
  // Throws an Error whose `code` is 'stale_weather_binding' or 'read_access_denied' when the binding is gone.
  weatherAdvice: (binding: WeatherAdviceBinding, options: {signal?: AbortSignal}) => Promise<unknown>;
}

const offline: PodVoiceApi = {
  timerAction: ({requestId}) => Promise.resolve(unknownReceipt(requestId)),
  weatherAdvice: () => Promise.reject(new Error('weather_advice_unavailable')),
};

export const useApi = create<{api: PodVoiceApi}>(() => ({api: offline}));
export const connectApi = (api: PodVoiceApi | null) => {
  useApi.setState({api: api ?? offline});
};
export const currentApi = () => useApi.getState().api;

// A same-origin client without the transport (tests, and the reference for what the transport sends).
export function fetchApi({
  pageUrl,
  snapshot,
  fetch = globalThis.fetch.bind(globalThis),
}: {
  pageUrl: string;
  snapshot: () => Snapshot | null;
  fetch?: typeof globalThis.fetch;
}): PodVoiceApi {
  const base = apiBase(pageUrl);
  return {
    async timerAction({requestId, ...request}) {
      const current = snapshot();
      if (!current) return unknownReceipt(requestId);
      const body = timerActionBody(current, request, requestId);
      try {
        const response = await fetch(endpointUrl(base, 'actions', current.roomId), {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: ACTION_HEADERS,
          body: JSON.stringify(body),
        });
        return readTimerReceipt(request, requestId, response, await response.json());
      } catch {
        return unknownReceipt(requestId);
      }
    },
    async weatherAdvice(binding, {signal}) {
      const url = new URL('weather-advice', base);
      url.searchParams.set('room', String(binding.roomId));
      const init: RequestInit = {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: ACTION_HEADERS,
        body: JSON.stringify({bootId: binding.bootId, roomId: binding.roomId, weatherKey: binding.weatherKey}),
      };
      if (signal) init.signal = signal;
      const response = await fetch(url, init);
      if (!response.ok) {
        const status = response.status;
        const code =
          status === 409 ? 'stale_weather_binding' : [401, 403].includes(status) ? 'read_access_denied' : undefined;
        throw Object.assign(new Error('weather_advice_unavailable'), {code});
      }
      return response.json() as Promise<unknown>;
    },
  };
}
