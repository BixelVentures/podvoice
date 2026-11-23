// The wall iPad sleeps. When the page is shown again (visibilitychange → visible, or a pageshow from the
// back-forward cache) the transport re-reads everything from HA's current `hass`, and reads HA does not push
// (forecasts, timers) are asked again. Nothing is replayed: a wish that was in flight stays as it is.
import type {HaTransport} from './transport';
import {transport as appTransport} from './transport';

export function installResync(source: HaTransport = appTransport, win: Window = globalThis.window): () => void {
  const doc = win.document;
  const visible = () => {
    if (doc.visibilityState === 'visible') source.resync();
  };
  const shown = () => {
    source.resync();
  };
  doc.addEventListener('visibilitychange', visible);
  win.addEventListener('pageshow', shown);
  return () => {
    doc.removeEventListener('visibilitychange', visible);
    win.removeEventListener('pageshow', shown);
  };
}
