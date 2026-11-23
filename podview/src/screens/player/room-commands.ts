// The room player's buttons as one command lifecycle (ported from room-player-controls.js): each tap is one direct
// call to the room's media_player (via PodVoice). Rules (AGENTS.md, music memory):
// - A tap shows its effect at once (the wish) and waits its turn behind a running call: never a locked button.
// - Last tap wins for absolute values (volume, seek replace the one still waiting); every toggle and skip tap is its
//   own action. Nothing is retried; a refused or unknown call drops the taps waiting behind it.
// - The next room read shows what really happened: the wish yields once the room shows it, or after 6 s (a move:
//   15 s). A failed effect gives one short toast only when the room does not show it within 6 s; nothing sticks.
// - A quick call changes its button once; only a slow one (≥ 800 ms) shows the busy ring.
// The store publishes the transport, volume and busy marks into the player store; React draws them.
import {createStore} from 'zustand/vanilla';
import {roomObservationDisplay} from '../../lib/api/media';
import type {Playback, PlayerAction} from '../../lib/api/media';
import {publishBusy, publishControls} from './store';
import type {SeekState} from './types';

export const RUNNING_RING_MS = 800;
export const OPTIMISTIC_MS = 6000;
export const MOVE_MS = 15000;
const FAILED: Record<string, string> = {
  rejected: 'Højttaleren afviste handlingen. Prøv igen.',
  unknown: 'Højttaleren svarede ikke. Tjek afspilleren, før du prøver igen.',
};

type Action = PlayerAction;
type Outcome = string;

export interface Wish {
  scope: string | null;
  at: number;
  playing?: boolean;
  volume?: number;
  seek?: {uri: string | null | undefined; positionMs: number};
  moving?: boolean;
}

interface Row {
  action: Action;
  value: number | undefined;
  scope: string | null;
  account: string;
  done: (sent: boolean) => void;
  startedAt?: number;
}

export interface RoomCommandsState {
  queue: Row[];
  running: Row | null;
  ring: boolean;
  desired: Wish | null;
  failed: {at: number; wish: Wish | null; action: Action; message: string} | null;
  status: string;
  observing: Action[];
}

export interface RoomCommandsHost {
  liveSnapshot?: unknown;
  liveTransport?: {connected?: boolean; generation?: unknown;
    playerAction?: (account: string, action: string, value?: number) => Promise<{outcome: Outcome}>;
    recordDiagnostic?: (stage: string, fields: Record<string, unknown>) => void} | null;
  liveMedia?: {playback?: Playback | null; account?: unknown; render?: () => void;
    refresh?: (options: {immediate: boolean}) => Promise<unknown> | undefined} | null;
  liveSelection?: {controlHold?: () => {blocked?: boolean; playing?: boolean} | null} | null;
  showFeedback?: (message: string, pending: boolean, options: {source: string}) => void;
}

const fresh = (p: Playback) => !p.stale && Date.now() <= p.expiresAt;

export function createRoomCommands(host: RoomCommandsHost) {
  const store = createStore<RoomCommandsState>(() => ({queue: [], running: null, ring: false, desired: null,
    failed: null, status: '', observing: []}));
  const {getState: get, setState: set} = store;
  let wishTimer: ReturnType<typeof setTimeout> | null = null;
  let ringTimer: ReturnType<typeof setTimeout> | undefined;

  function playback(): Playback | null {
    const media = host.liveMedia, p = media?.playback;
    return p && roomObservationDisplay(p, host.liveSnapshot as never, media.account) ? p : null;
  }
  const scope = (p = playback()) =>
    p ? JSON.stringify([p.bootId, p.roomId, p.config_entry_id, host.liveTransport?.generation ?? null]) : null;
  // A room that could not be read (stale or a transient read failure) is shown as last known, never controlled.
  const can = (action: string, p = playback()) =>
    !!p && fresh(p) && host.liveTransport?.connected === true && p.controls.actions.includes(action as Action);
  function wish(p = playback()): Wish | null {
    const d = get().desired;
    return d?.scope === scope(p) ? d : null;
  }
  const busy = () => !!get().running || get().queue.length > 0;
  // "Flyt til <rum>" was tapped and the room does not play it yet.
  const moving = () => wish()?.moving === true;
  function optimisticPlaying(observed: boolean) {
    const d = wish();
    return d && typeof d.playing === 'boolean' ? d.playing : observed;
  }
  function volume(p = playback()) {
    const d = wish(p);
    return Number.isInteger(d?.volume) ? d?.volume ?? null : p?.volume ?? null;
  }
  function seekState(trackUri: string | undefined): SeekState | null {
    const p = playback(), duration = p?.item?.duration_ms;
    if (!p || !can('seek', p) || !trackUri || p.item?.uri !== trackUri || !Number.isSafeInteger(duration)) return null;
    const d = wish(p);
    return {
      witness: {key: JSON.stringify([scope(p), trackUri]), transport: host.liveTransport, trackUri,
        durationMs: duration ?? 0},
      positionMs: d?.seek?.uri === trackUri ? d.seek.positionMs : null,
    };
  }

  // The optimistic wish is cleared when its time runs out, also when no room read arrives.
  function expireWish(next: Wish) {
    if (wishTimer) clearTimeout(wishTimer);
    wishTimer = setTimeout(() => {
      wishTimer = null;
      if (get().desired !== next) return;
      if (busy()) {
        expireWish(next);
        return;
      }
      set({desired: null});
      render();
      host.liveMedia?.render?.();
    }, next.moving ? MOVE_MS : OPTIMISTIC_MS);
    (wishTimer as {unref?: () => void}).unref?.();
  }

  // One tap. Resolves whether HA accepted it.
  function intent(action: Action, input: {percent?: unknown; positionMs?: unknown;
    witness?: {trackUri?: string}} = {}): Promise<boolean> {
    const p = playback(), key = scope(p), toggle = action === 'pause' || action === 'resume';
    if (!p || !(can(action, p) || toggle && (can('pause', p) || can('resume', p)))) return Promise.resolve(false);
    let value: number | undefined;
    if (action === 'volume') {
      value = Math.round(Number(input.percent));
      if (!Number.isInteger(value) || value < 0) return Promise.resolve(false);
      value = Math.min(value, p.controls.maxVolume ?? 0);
    }
    if (action === 'seek') {
      value = input.positionMs as number;
      if (!Number.isSafeInteger(value) || value < 0 ||
        input.witness?.trackUri && input.witness.trackUri !== p.item?.uri)
        return Promise.resolve(false);
    }
    const next: Wish = {...(wish(p) ?? {}), scope: key, at: Date.now()};
    if (toggle) next.playing = action === 'resume';
    if (action === 'volume' && value !== undefined) next.volume = value;
    if (action === 'seek' && value !== undefined) next.seek = {uri: p.item?.uri, positionMs: value};
    if (action === 'next' || action === 'previous') delete next.seek;
    if (action === 'move_here') next.moving = true;
    // An absolute value replaces the one still waiting; every toggle/skip tap is its own action.
    const waiting = action === 'volume' || action === 'seek' ? get().queue.filter(row => row.action !== action)
      : get().queue;
    let done: (sent: boolean) => void = () => undefined;
    const promise = new Promise<boolean>(resolve => {
      done = resolve;
    });
    set({desired: next, status: '', failed: null,
      queue: [...waiting, {action, value, scope: key, account: p.config_entry_id, done}]});
    expireWish(next);
    host.liveTransport?.recordDiagnostic?.('control_intent', {domain: 'music', action, code: 'queued'});
    render();
    host.liveMedia?.render?.();
    void drain();
    return promise;
  }

  async function drain() {
    if (get().running) return;
    while (get().queue.length) {
      const [row, ...rest] = get().queue;
      if (!row) break;
      set({queue: rest});
      if (row.scope !== scope()) {
        row.done(false);
        continue;
      }
      row.startedAt = Date.now();
      set({running: row, ring: false});
      clearTimeout(ringTimer);
      ringTimer = setTimeout(() => {
        if (get().running === row) {
          set({ring: true});
          render();
        }
      }, RUNNING_RING_MS);
      render();
      let result: {outcome: Outcome};
      try {
        const transport = host.liveTransport;
        if (!transport?.playerAction) throw Error('no_transport');
        result = await transport.playerAction(row.account, row.action, row.value);
      } catch {
        result = {outcome: 'unknown'};
      }
      clearTimeout(ringTimer);
      set({running: null, ring: false});
      row.done(result.outcome === 'accepted');
      if (result.outcome === 'accepted') set({observing: [...get().observing, row.action]});
      else {
        // An honest outcome, never an automatic retry. Waiting taps were meant for the state before. No text stays
        // in the player or queue: the next room read decides (observe).
        for (const waiting of get().queue) waiting.done(false);
        set({queue: [], desired: null, failed: {at: Date.now(), wish: get().desired, action: row.action,
          message: FAILED[result.outcome] ?? FAILED.unknown ?? ''}});
      }
    }
    render();
    host.liveMedia?.render?.();
    void host.liveMedia?.refresh?.({immediate: true})?.catch(() => undefined);
  }

  // A fresh room read: the optimistic wish yields once the room shows it, or after a short while.
  function observe(next: Playback) {
    // A refused tap whose effect the room shows anyway (Speakers may report a pause as failed) is silent. Only an
    // effect that did not happen gives one short toast; nothing stays on screen.
    const f = get().failed;
    if (f) {
      set({failed: null});
      const happened = typeof f.wish?.playing === 'boolean' ? (next.state === 'playing') === f.wish.playing
        : Number.isInteger(f.wish?.volume) ? next.volume === f.wish?.volume : false;
      if (!happened && Date.now() - f.at <= OPTIMISTIC_MS) {
        host.showFeedback?.('', false, {source: 'music-toast'});
        host.showFeedback?.(f.message, false, {source: 'music-toast'});
      }
    }
    // The first room read after accepted calls is their observed effect (diagnostics only).
    if (!busy() && get().observing.length) {
      for (const action of get().observing)
        host.liveTransport?.recordDiagnostic?.('playback_confirmation', {domain: 'music', action, code: 'confirmed'});
      set({observing: []});
    }
    const d = get().desired;
    // A move is shown until the room plays (or a short while passes); then the room player decides.
    if (!d || busy()) return;
    // A seek is reached when the room reports the same song near the chosen position (no hop back).
    const progress = next.progressMs ?? NaN;
    const seekReached = !d.seek || next.item?.uri === d.seek.uri && Number.isSafeInteger(progress) &&
      progress >= d.seek.positionMs - 1000 && progress <= d.seek.positionMs + 4000;
    const reached = (!d.moving || next.elsewhere !== true) &&
      (typeof d.playing !== 'boolean' || (next.state === 'playing') === d.playing) &&
      (!Number.isInteger(d.volume) || next.volume === d.volume) && seekReached;
    if (reached || Date.now() - d.at > (d.moving ? MOVE_MS : OPTIMISTIC_MS)) set({desired: null});
  }

  function invalidate() {
    if (wishTimer) clearTimeout(wishTimer);
    wishTimer = null;
    for (const row of get().queue) row.done(false);
    set({queue: [], desired: null, status: '', observing: []});
  }

  // The player's transport and volume for the room player. A chosen song on its way holds them (requesting /
  // accepted); its confirmed settlement gives them back while the chosen song is still shown as playing.
  function render() {
    const hold = host.liveSelection?.controlHold?.() ?? null, held = hold?.blocked === true;
    const p = playback(), playing = hold ? !!hold.playing : !!p && optimisticPlaying(p.state === 'playing');
    const toggle = playing ? 'pause' : 'resume', has = (action: string) => can(action, p);
    const shown = held ? null : volume(p), canVolume = !held && has('volume') && Number.isInteger(shown);
    publishControls({playing, previous: has('previous'), next: has('next'), toggle: has(toggle), blocked: !p || held,
      volumeBlocked: !p || held, volume: shown, canVolume, min: 0, max: p?.controls.maxVolume ?? 100});
    // A running call shows on its button (after 800 ms); the buttons stay usable and further taps queue.
    const running = get().running?.action ?? null;
    publishBusy({ring: get().ring ? running : null, transport: !!running && !['volume', 'seek'].includes(running),
      volume: running === 'volume'});
    return {transport: !held && (has('pause') || has('resume') || has('next') || has('previous')), canVolume};
  }

  return Object.assign(store, {playback, scope, can, wish, busy, moving, optimisticPlaying, volume, seekState, intent,
    drain, observe, invalidate, render,
    get status() {
      return get().status;
    }});
}

export type RoomCommands = ReturnType<typeof createRoomCommands>;
