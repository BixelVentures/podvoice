// The shared player's session, outside React: which source it shows (music, radio or auto), the speaker the user
// chose last, who a volume or seek gesture belongs to, and the mute record. The shell reads it as `playerView`,
// live radio as its player (source.ts) and the components through the hooks in Player.tsx. Nothing here draws.
import {create} from 'zustand';
import {playbackBinding, playbackObservationCurrent, roomObservationCurrent, roomObservationDisplay}
  from '../../lib/api/media';
import {PLAYER_SPEAKER_IDLE_MS, autoSourceFocus} from './player-model';
import {playerHost, usePlayer} from './store';
import type {FocusTicket, PlayerModel, RadioHistory, SeekState, SeekWitness, SourceFocus, SpeakerChoice,
  VolumeWitness} from './types';

// The mute record: the last audible volume of this binding, and a mute or unmute on its way.
interface MuteState {
  binding: string;
  restore: number | null;
  request: {from: number | null | undefined; value: number} | null;
}

export const useMute = create<MuteState>(() => ({binding: '', restore: null, request: null}));

let chosen: SpeakerChoice | null = null;
let focus: SourceFocus | null = null;
const witnesses = new Map<string, VolumeWitness>();

const host = playerHost;

// The radio model when radio holds the shared player (its start, or a radio that plays or stopped in the last
// 10 minutes), else null.
export function radioPlayerModel(): PlayerModel | null {
  const radio = host().liveRadio;
  return radio?.presentsPlayer() ? radio.playerModel() : null;
}

// What the player shows now: radio when it holds the player, else what the music owner published.
export function shownModel(): PlayerModel {
  return (host().live ? radioPlayerModel() : null) ?? usePlayer.getState().model;
}

export function sourceScope(): string | null {
  const s = host().liveSnapshot;
  return s?.bootId && s.roomId ? JSON.stringify([s.bootId, s.roomId]) : null;
}

// One scoped presentation choice; it never grants or repeats an effect. The player owns the speaker choice (test
// 11): the user's last explicit speaker stays until the user changes it, or until 10 min pass with nothing playing
// or paused. Radio and music start there.
export function chooseSpeaker(row: {homepodId?: string | null; id?: string; nativeRoomId?: string | null;
  name?: string} | null) {
  const homepodId = row?.homepodId ?? row?.id;
  if (!row || !homepodId) return;
  chosen = {homepodId, nativeRoomId: row.nativeRoomId ?? null, name: row.name || '', at: Date.now(),
    scope: sourceScope()};
}

export function playerSpeaker(): SpeakerChoice | null {
  const h = host(), c = chosen, p = h.liveMedia?.playback;
  const radio = h.liveRadio?.getState().value?.state;
  const active = (['playing', 'paused'].includes(p?.state ?? '') && roomObservationDisplay(p, h.liveSnapshot)) ||
    (['playing', 'stopped'].includes(radio?.status ?? '') && radio?.sourceKind === 'radio');
  if (c?.scope === sourceScope() && (active || Date.now() - (c.at ?? 0) < PLAYER_SPEAKER_IDLE_MS)) {
    if (active) c.at = Date.now();
    return c;
  }
  chosen = null;
  const b = playbackBinding(p, h.liveSnapshot, h.liveMedia?.account);
  return b ? {homepodId: b.nativeHomepodId, nativeRoomId: b.nativeRoomId, name: ''} : null;
}

// The shared player's source focus is always explicit: music, radio or auto. It is scoped to boot and room; a new
// scope starts at auto.
export function currentSourceFocus(): SourceFocus {
  const scope = sourceScope();
  if (focus?.scope !== scope) focus = autoSourceFocus(scope);
  return focus;
}

export function focusSource(kind: string, target: Record<string, unknown> | null = null): boolean {
  const scope = sourceScope();
  if ((kind !== 'music' && kind !== 'radio') || !scope) return false;
  const changed = currentSourceFocus().kind !== kind;
  focus = Object.freeze({scope, kind, target: target ? Object.freeze({...target}) : null});
  if (kind === 'music') host().liveRadio?.closeOutputs();
  return changed;
}

export function beginSourceFocus(kind: string, target: Record<string, unknown> | null = null): FocusTicket {
  const previous = currentSourceFocus();
  focusSource(kind, target);
  return Object.freeze({previous, current: focus, scope: sourceScope()});
}

// A refused or unknown outcome did not prove the new source, so the player returns to its previous focus.
export function finishSourceFocus(ticket: FocusTicket | null | undefined, outcome: string): boolean {
  if (!['rejected', 'unknown'].includes(outcome) || sourceScope() !== ticket?.scope || focus !== ticket.current)
    return false;
  focus = ticket.previous?.scope === ticket.scope ? ticket.previous : autoSourceFocus(ticket.scope);
  return true;
}

export function sourceFocused(kind: string): boolean {
  const current = currentSourceFocus();
  return current.kind === 'auto' || current.kind === kind;
}

// A new radio owner process: its mute record and a radio source focus belong to the old one.
export function forgetRadioOwner() {
  useMute.setState({binding: '', restore: null, request: null});
  if (focus?.kind === 'radio') focus = Object.freeze({scope: focus.scope, kind: 'auto', target: null});
}

// Music observed after radio stopped (in this room, or on the speaker radio last used) takes the player back.
export function radioHistorySuperseded(history: RadioHistory | null | undefined): boolean {
  if (!history) return false;
  if (history.scope !== sourceScope()) return false;
  if (history.superseded) return true;
  const h = host(), p = h.liveMedia?.playback, s = h.liveSnapshot;
  if (p?.source === 'spotify' && ['playing', 'buffering'].includes(p.state) && roomObservationCurrent(p, s))
    return (history.superseded = true);
  const b = p?.state === 'playing' && playbackObservationCurrent(p, s) && roomObservationCurrent(p, s)
    ? playbackBinding(p, s, h.liveMedia?.account) : null;
  if (b && b.nativeRoomId === history.targetId && Number.isFinite(history.observedAt) &&
    Date.parse(p?.observedAt ?? '') >= ((history.observedAt ?? 0) + 1) * 1000) history.superseded = true;
  return history.superseded === true;
}

// One source's own model (Home's facts and Find musik read it while the other source holds the player).
export function sourceModel(kind: string): PlayerModel {
  const h = host();
  if (h.live !== true) return usePlayer.getState().model;
  if (kind === 'music' && h.liveRadio?.ownsPlayer()) return {};
  return (kind === 'radio' ? h.liveRadio?.playerModel() : h.liveMedia?.observedPlayerModel?.()) ?? {};
}

// The volume binding: which source's volume a gesture or a mute changes.
export function volumeBinding(): string {
  const h = host();
  if (h.live && h.liveRadio?.ownsPlayer()) {
    if (!h.liveRadio.hasSource()) return '';
    const r = h.liveRadio.getState().value, s = r?.state;
    return JSON.stringify(['radio', r?.bootId, r?.roomId, r?.ownerProcessId, s?.targetId, s?.ownerGeneration]);
  }
  if (h.live) {
    const p = h.liveMedia?.playback, s = h.liveSnapshot;
    if (!p || !s) return '';
    return roomObservationDisplay(p, s) ? JSON.stringify(['room-player', s.bootId, s.roomId, p.config_entry_id]) : '';
  }
  const s = h.state, p = s?.music?.playback;
  return p ? JSON.stringify([s.sessionId, p.accountId, p.kind, p.targetId, p.room]) : '';
}

const ownerKind = (): 'music' | 'radio' => host().liveRadio?.ownsPlayer() ? 'radio' : 'music';

// A range gesture belongs to the source that was visible at its first input. It may never be retargeted by a later
// radio/music ownership transition.
export function beginVolumeGesture(input: string, mode = 'pointer'): VolumeWitness | null {
  const h = host(), binding = volumeBinding();
  if (h.live !== true || !binding) return null;
  const witness: VolumeWitness = Object.freeze({binding, sourceKind: ownerKind(), transport: h.liveTransport,
    transportGeneration: h.liveTransport?.generation, mode, pointerHeld: mode === 'pointer'});
  witnesses.set(input, witness);
  return witness;
}

export const volumeWitness = (input: string) => witnesses.get(input) ?? null;

export function releaseVolumePointer(input: string) {
  const witness = witnesses.get(input);
  if (witness?.mode === 'pointer') witnesses.set(input, Object.freeze({...witness, pointerHeld: false}));
}

export function endVolumeGesture(input: string) {
  witnesses.delete(input);
}

export function volumeGestureCurrent(witness: VolumeWitness | null | undefined): boolean {
  const h = host();
  if (!witness || h.live !== true || !h.isConnected || !h.liveTransport?.connected ||
    witness.transport !== h.liveTransport || witness.transportGeneration !== h.liveTransport.generation ||
    witness.binding !== volumeBinding() || witness.sourceKind !== ownerKind()) return false;
  return witness.sourceKind === 'radio' ? h.liveRadio?.can('volume') === true
    : h.liveControls?.player?.can('volume') === true;
}

// The released value of a volume gesture: one volume tap for the source it began on.
export function commitVolume(input: string, value: string, disabled: boolean): boolean {
  const h = host();
  if (h.live !== true) return false;
  const witness = witnesses.get(input) ?? beginVolumeGesture(input, 'change');
  if (witness?.mode !== 'key') witnesses.delete(input);
  if (disabled || !volumeGestureCurrent(witness)) {
    h.liveMedia?.render?.();
    return false;
  }
  usePlayer.getState().ports.music({type: 'volume', value, volumeSource: witness});
  return true;
}

// The mute button follows the shown volume: a new binding forgets the old record, a known audible volume is what
// unmute restores, and a request ends when the volume moved.
export function noteVolume(volume: number | null | undefined) {
  const binding = volumeBinding(), state = useMute.getState();
  let {restore, request} = state.binding === binding ? state : {restore: null, request: null};
  const known = typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100;
  if (known && volume > 0 && binding) restore = volume;
  if (request && known && volume !== request.from) request = null;
  if (state.binding !== binding || state.restore !== restore || state.request !== request)
    useMute.setState({binding, restore, request});
}

export function toggleMute(volume: number | null | undefined) {
  const state = useMute.getState();
  if (volumeBinding() !== state.binding) return;
  const value = volume === 0 ? state.restore : 0;
  if (value === null || !Number.isInteger(value)) return;
  useMute.setState({request: {from: volume, value}});
  usePlayer.getState().ports.music({type: 'volume', value});
}

// Who may seek, and on which song: never from interpolation; a live seek needs the room player's own grant.
export function seekState(vm: PlayerModel | null = shownModel()): SeekState | null {
  const h = host();
  if (!vm?.active || vm.sourceKind === 'radio' || vm.loading) return null;
  if (!h.live) return vm.canSeek && vm.examplePosition ? {witness: {trackId: vm.trackId, operation: vm.seekOperation}}
    : null;
  if (!vm.fresh || !vm.positionFresh) return null;
  return h.liveControls?.musicSeekState?.(vm.uri) ?? null;
}

export function sameSeek(a: SeekWitness | null | undefined, b: SeekWitness | null | undefined): boolean {
  if (!a || !b) return false;
  return host().live ? a.key === b.key && a.transport === b.transport
    : a.trackId === b.trackId && a.operation === b.operation;
}

// A fresh page life (tests).
export function resetSession() {
  chosen = null;
  focus = null;
  witnesses.clear();
  useMute.setState({binding: '', restore: null, request: null});
}

// The session as the shell (`playerView`) and live radio (its player) read it.
export const playerSession = {
  chooseSpeaker,
  playerSpeaker,
  sourceScope,
  currentSourceFocus,
  focusSource,
  beginSourceFocus,
  finishSourceFocus,
  sourceFocused,
  forgetRadioOwner,
  radioHistorySuperseded,
  sourceModel,
  volumeBinding,
  volumeGestureCurrent,
  // The queue rows the full player shows (Home's facts name the next song) and the queue's status.
  queueRows: () => usePlayer.getState().queue.items.filter(item =>
    typeof item.title === 'string' && !!item.title.trim()),
  queueStatus: () => usePlayer.getState().queue.options.status ?? 'ready',
  get progressVM(): PlayerModel {
    return shownModel();
  },
  get chosenSpeaker() {
    return chosen;
  },
};
export type PlayerSession = typeof playerSession;
