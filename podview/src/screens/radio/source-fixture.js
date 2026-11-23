// The live radio source wired the way the shell wires it (widget-view.js connectReactApi, publishConnection,
// state.ts), over a plain host object as the pre-React tests built it: `liveTransport` (radio, radioOffer,
// radioAction, recordDiagnostic, connected, recoveryBlocked, generation), `liveSnapshot`, `playerView` (the player's
// session), `ownerDocument` and `browserOffline`. Each transport object is one API, as the shell registers one
// per transport.
import {offlineApi} from '../../lib/api/client';
import {createRadioSource} from './source';

const apis = new WeakMap();

export function apiOf(transport) {
  if (!transport) return offlineApi;
  if (!apis.has(transport))
    apis.set(transport, {
      ...offlineApi,
      radio: () => transport.radio(),
      radioOffer: intent => transport.radioOffer(intent),
      radioAction: offer => transport.radioAction(offer),
      diagnostics: {
        generation: () => transport.generation,
        blocked: () => transport.recoveryBlocked === true,
        record: (stage, fields) => transport.recordDiagnostic?.(stage, fields),
      },
    });
  return apis.get(transport);
}

export function connectionOf(host) {
  const t = host.liveTransport;
  return {mode: 'live', status: t?.connected ? 'connected' : 'disconnected', connected: t?.connected === true,
    blocked: t?.recoveryBlocked === true, sessionExpired: t?.sessionExpired === true,
    browserOffline: host.browserOffline === true, acceptedReadAt: null};
}

export function radioOf(host, {storage = () => null} = {}) {
  return createRadioSource({
    api: () => apiOf(host.liveTransport),
    snapshot: () => host.liveSnapshot ?? null,
    connection: () => connectionOf(host),
    player: () => host.playerView,
    hidden: () => host.ownerDocument?.visibilityState === 'hidden',
    storage,
  });
}

// What the shell redraws on a radio change (widget-view.js renderRadioSource).
export function shellRender(radio, host) {
  const feedback = radio.notice();
  host.showFeedback?.(feedback?.message || '', false, {source: 'radio'});
  host.render?.();
  // The player and the speaker sheet read the radio source themselves; music is redrawn when radio gives it back.
  if (!(radio.presentsPlayer() && radio.playerModel())) host.liveMedia?.render?.();
}

// What the shared player draws for radio (Player.tsx reads it from the source): its model, controls and queue.
export function radioFrame(radio) {
  if (!radio.presentsPlayer()) return null;
  const model = radio.playerModel();
  return model ? {model, controls: radio.controls()} : null;
}
