// The PodVoice calls the React screens make. One implementation is registered at a time: in the live screen the
// connection owner (podvoice-transport.js, which signs each request into its read generation and diagnostics) is
// registered by the shell when it connects; tests register a plain fetch client against MSW.
import {create} from 'zustand';
import {ACTION_HEADERS, apiBase, endpointUrl} from './paths';
import type {RadioAction} from './radio';
import {readRadioReceipt} from './schemas';
import type {RadioOffer, RadioReceipt, Snapshot} from './schemas';
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

// One radio intent, offered by the owner before it is sent (podview_radio.py).
export interface RadioIntent {
  bootId: string;
  roomId: string;
  revision: number;
  action: RadioAction;
  stationId: string | null;
  targetId: string | null;
  volumePercent: number | null;
}

export interface PodVoiceApi {
  diagnostics?: ApiDiagnostics;
  // The radio owner's observation, unparsed (lib/api/radio.ts admits it). Throws an Error whose `code` is
  // 'read_access_denied' when access is refused.
  radio: () => Promise<unknown>;
  // Throws when no offer is made; the offer is checked by its reader.
  radioOffer: (intent: RadioIntent) => Promise<unknown>;
  // Never throws: an unreadable answer is UNKNOWN.
  radioAction: (offer: RadioOffer) => Promise<RadioReceipt>;
  timerAction: (request: TimerRequest & {requestId: string}) => Promise<TimerReceipt>;
  // Throws an Error whose `code` is 'stale_weather_binding' or 'read_access_denied' when the binding is gone.
  weatherAdvice: (binding: WeatherAdviceBinding, options: {signal?: AbortSignal}) => Promise<unknown>;
}

// No connection: nothing is sent; tests start from it.
export const offlineApi: PodVoiceApi = {
  timerAction: ({requestId}) => Promise.resolve(unknownReceipt(requestId)),
  weatherAdvice: () => Promise.reject(new Error('weather_advice_unavailable')),
  radio: () => Promise.reject(new Error('radio_offline')),
  radioOffer: () => Promise.reject(new Error('radio_offline')),
  radioAction: () => Promise.resolve({status: 'rejected'}),
};

export const useApi = create<{api: PodVoiceApi}>(() => ({api: offlineApi}));
export const connectApi = (api: PodVoiceApi | null) => {
  useApi.setState({api: api ?? offlineApi});
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
    async radio() {
      const current = snapshot();
      const response = await fetch(endpointUrl(base, 'radio', current?.roomId), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok)
        throw Object.assign(new Error('radio_unavailable'), {
          code: [401, 403].includes(response.status) ? 'read_access_denied' : undefined,
        });
      return response.json() as Promise<unknown>;
    },
    async radioOffer(intent) {
      const current = snapshot();
      if (intent.bootId !== current?.bootId || intent.roomId !== current.roomId) throw new Error('radio_scope_changed');
      const response = await fetch(new URL('radio/offer', base), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: ACTION_HEADERS,
        body: JSON.stringify(intent),
      });
      const body = (await response.json()) as {ok?: unknown};
      if (!response.ok || body.ok !== true) throw new Error('radio_offer_unavailable');
      return body;
    },
    async radioAction(offer) {
      const current = snapshot();
      if (offer.bootId !== current?.bootId || offer.roomId !== current.roomId) return {status: 'rejected'};
      try {
        const response = await fetch(new URL('radio/actions', base), {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: ACTION_HEADERS,
          body: JSON.stringify({bootId: offer.bootId, roomId: offer.roomId, taskId: offer.taskId,
            optionId: offer.optionId}),
        });
        const body = (await response.json()) as {ok?: unknown; schema?: unknown; retryAllowed?: unknown};
        const valid = response.ok && body.ok === true && body.schema === 'podview.radio-action.v1' &&
          body.retryAllowed === false;
        return valid ? readRadioReceipt(body) : {status: 'unknown'};
      } catch {
        return {status: 'unknown'};
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
