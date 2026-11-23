// Live radio: the radio owner's observation and the radio commands, one Zustand store (ported from the shell's
// LiveRadioView). Rules (AGENTS.md, R4):
// - Only an admitted observation (lib/api/radio.ts) is shown; it belongs to boot, room and provider generation and
//   expires at its validUntil. A voice turn is no new radio owner.
// - One explicit tap is one action: offer → send → confirmed by a newer observation within 8 s, or an honest
//   unknown. An unknown or unreadable outcome is never resent; a new explicit tap is a new action.
// - Taps during a command queue instead of locking: a station tapped while one starts follows it, Stop tapped while
//   a station starts is sent once that start is observed, volume changes coalesce to the last value and Stop wins.
// - The last confirmed station survives a stop (and a reload) for 10 minutes, like a paused song.
// The shared right-hand player (PlayerView) and the speaker sheet (SpeakerOutputView) are not React yet: the radio
// paints into them through the ports the shell registers (RadioPlayer, RadioOutputs). The shell and the React radio
// screen subscribe to this store.
import {createStore} from 'zustand/vanilla';
import type {PodVoiceApi} from '../../lib/api/client';
import {
  STOPPED_KEEP_MS,
  configurationReason,
  radioId,
  radioObservation,
  radioStation,
} from '../../lib/api/radio';
import type {RadioAction, RadioObservation, RadioState, RadioTarget} from '../../lib/api/radio';
import {radioOfferSchema} from '../../lib/api/schemas';
import type {Snapshot} from '../../lib/api/schemas';
import type {Connection} from '../../lib/query/live';

export const UNCONFIRMED_TEXT = 'Radioændringen er ikke bekræftet. Tjek afspilleren.';
const ERROR_TEXT = 'Radio kunne ikke afspilles.';
// The native owner reports playing when audio flows; read it again soon after an accepted receipt.
const CONFIRM_READ_MS = 200;
const CONFIRM_WITHIN_MS = 8000;
const STATION_STORE = 'podview.radioStation';

// Which control a command came from (its spinner).
export interface Origin {
  kind: 'station' | 'output' | 'volume' | 'transport';
  id: string;
}

export interface PendingRequest {
  action: RadioAction;
  stationId: string | null;
  targetId: string | null;
  targetName: string;
  volumePercent: number | null;
  stationChoiceTarget: string | undefined;
  stationChoiceAllowed: boolean;
}

export type Confirmed = RadioState & {targetName?: string};

interface ChoiceScope {
  key: string;
  api: PodVoiceApi;
  targetId: string;
}

export interface StationChoice {
  action?: 'stop';
  stationId?: string;
  origin: Origin | null;
  scope: ChoiceScope | null;
  afterStart?: PendingRequest;
  started?: {generation: number; ownerGeneration: number | undefined};
}

// What the player's radio history check marks (PlayerView.radioHistorySuperseded).
export interface StoppedHistory {
  key: string;
  scope: string;
  stationId: string | null;
  targetId: string | null;
  observedAt: number | null | undefined;
  superseded: boolean;
}

export interface RadioSourceState {
  value: RadioObservation | null;
  epoch: number;
  pending: boolean;
  pendingControl: Readonly<Origin> | null;
  pendingRequest: Readonly<PendingRequest> | null;
  pendingScope: string | null;
  pendingApi: PodVoiceApi | null;
  pendingPhase: 'preparing' | 'sending' | null;
  sentOperation: {epoch: number; generation: number; bootId: string} | null;
  unknown: boolean;
  unknownGeneration: number | null;
  unknownRevision: number | null;
  unknownBoot: string | null;
  message: string;
  feedbackKind: 'error' | 'unknown' | null;
  ownerProcessId: string | null;
  retiredOwners: readonly string[];
  lastConfirmed: Confirmed | null;
  lastConfirmedAt: number | null;
  nextTarget: string | null;
  waitingStation: string | null;
  outputOpen: boolean;
  stationChoices: StationChoice[];
  stopWish: Origin | null;
  volumeWish: number | null;
  volumeTarget: number | null;
  diagnosticReadFailed: boolean;
  // Bumped when the observation expires, so subscribers redraw without it.
  expired: number;
}

export interface RadioControls {
  sourceKind: 'radio';
  playing: boolean;
  loadingControlId: string | null;
  pendingLabel?: string;
  blocked: boolean;
  toggle: boolean;
  volume: number | null;
  canVolume: boolean;
}

export interface RadioPlayerModel {
  active: true;
  sourceKind: 'radio';
  playing: boolean;
  fresh: boolean;
  loading?: boolean;
  title: string;
  artist: string;
  fixtureArt: string;
  target: string;
  volume: number | null;
  canOutput: boolean;
  canDiscover: boolean;
  canSeek: false;
  controlStatus?: string;
  feedback: {state?: string; message: string; pending?: boolean} | null;
}

// The shared player as radio uses it (PlayerView, not React yet).
export interface RadioPlayer {
  sourceFocused?: (kind: 'radio') => boolean;
  radioHistorySuperseded?: (history: StoppedHistory | null) => boolean;
  playerSpeaker?: () => {homepodId?: string | null; name?: string | null} | null;
  focusSource?: (kind: 'radio', target: {targetId: string | null}) => boolean;
  beginSourceFocus?: (kind: 'radio', target: {targetId: string | null}) => unknown;
  finishSourceFocus?: (ticket: never, outcome: string) => boolean;
  chooseSpeaker?: (row: RadioTarget) => void;
  forgetRadioOwner?: () => void;
  renderPlayer: (model: RadioPlayerModel) => void;
  renderControls: (model: RadioControls) => void;
  renderQueue: (items: [], options: {sourceKind: 'radio'}) => void;
}

export interface RadioOutputsModel {
  targets: RadioTarget[];
  actualTargetId: string | null;
  lastTargetId: string | null;
  nextTargetId: string | null;
  message: string;
  selectable: (row: RadioTarget) => boolean;
  onChoose: (row: RadioTarget) => void;
}

// The speaker sheet (SpeakerOutputView) and its native dialog.
export interface RadioOutputs {
  radioSheet?: boolean;
  bindRadioClose: () => void;
  closeRadioSheet: () => void;
  renderRadioOutputs: (model: RadioOutputsModel) => void;
}

export interface RadioDeps {
  api: () => PodVoiceApi;
  snapshot: () => Snapshot | null;
  connection: () => Connection;
  player?: () => RadioPlayer | null | undefined;
  outputs?: () => RadioOutputs | null | undefined;
  dialog?: () => HTMLDialogElement | null | undefined;
  hidden?: () => boolean;
  now?: () => number;
  storage?: () => Storage | null | undefined;
}

const INITIAL: RadioSourceState = {
  value: null,
  epoch: 0,
  pending: false,
  pendingControl: null,
  pendingRequest: null,
  pendingScope: null,
  pendingApi: null,
  pendingPhase: null,
  sentOperation: null,
  unknown: false,
  unknownGeneration: null,
  unknownRevision: null,
  unknownBoot: null,
  message: '',
  feedbackKind: null,
  ownerProcessId: null,
  retiredOwners: [],
  lastConfirmed: null,
  lastConfirmedAt: null,
  nextTarget: null,
  waitingStation: null,
  outputOpen: false,
  stationChoices: [],
  stopWish: null,
  volumeWish: null,
  volumeTarget: null,
  diagnosticReadFailed: false,
  expired: 0,
};

const IDLE = {pending: false, pendingControl: null, pendingRequest: null, pendingPhase: null} as const;
const settled = (status: unknown) => ['playing', 'stopped', 'idle'].includes(status as string);
const usable = (t: RadioTarget | undefined): t is RadioTarget =>
  !!t && t.selectable && t.availability === 'available';

export function createRadioSource(deps: RadioDeps) {
  const now = deps.now ?? (() => Date.now());
  const store = createStore<RadioSourceState>(() => INITIAL);
  const get = store.getState;
  const set = store.setState;
  // Outside the store: the read in flight and its scope, the timers, and the player's stopped-history record.
  let read: Promise<void> | null = null;
  let readScope: string | null = null;
  let binding: string | undefined;
  let lastRead = 0;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let settleResolve: (() => void) | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setTimeout> | null = null;
  let stoppedHistory: StoppedHistory | null = null;

  const player = () => deps.player?.() ?? null;
  const snapshot = () => deps.snapshot();
  const sameOwner = (v: RadioObservation | null) => {
    const s = snapshot();
    return !!v && v.bootId === s?.bootId && v.roomId === s.roomId;
  };
  const record = (api: PodVoiceApi, stage: string, fields: Record<string, unknown>) => {
    try {
      api.diagnostics?.record(stage, fields);
    } catch {
      /* Diagnostics never alter radio control. */
    }
  };

  // Radio actions belong to boot, room and provider generation. A voice turn (sessionId, taskId, inputRevision) is
  // no new radio owner, so it must not turn a radio action into unknown.
  function scope() {
    const s = snapshot();
    return JSON.stringify([s?.bootId, s?.roomId, s?.providerGeneration]);
  }

  function setupIssue() {
    const v = get().value;
    return sameOwner(v) ? configurationReason(v) : null;
  }

  // The speaker radio plays on: the observed target, else the default target PodConnect offers.
  function targetName() {
    const v = get().value;
    if (!v?.enabled || !sameOwner(v)) return null;
    const target = v.targets.find(t => t.id === v.state.targetId) ?? v.targets.find(t => t.default);
    return target?.name ?? null;
  }

  function current(): boolean {
    const v = get().value, c = deps.connection();
    return !!v?.enabled && c.connected && !c.blocked && !c.browserOffline && sameOwner(v) &&
      (v.validUntil ?? 0) * 1000 > now();
  }

  function hasSource() {
    const v = get().value, s = v?.state;
    return !!v?.enabled && sameOwner(v) && s?.sourceKind === 'radio' && Number.isSafeInteger(s.ownerGeneration) &&
      !!radioStation(s.stationId);
  }

  // A radio stopped in the last 10 minutes still owns the player, like a paused song.
  function knownStopped(): boolean {
    const {value: v, lastConfirmed: last, lastConfirmedAt} = get(), s = v?.state;
    const valid = !!v && !!s && !!last && now() - (lastConfirmedAt ?? now()) < STOPPED_KEEP_MS && v.enabled &&
      sameOwner(v) && s.sourceKind === 'none' && s.status === 'stopped' && last.sourceKind === 'radio' &&
      !!radioStation(last.stationId) && typeof last.targetId === 'string' && !!last.targetId &&
      Number.isSafeInteger(last.generation) && last.generation <= s.generation;
    if (!valid) {
      stoppedHistory = null;
      return false;
    }
    const key = JSON.stringify([JSON.stringify([v.bootId, v.roomId]), s.generation, last.stationId, last.targetId]);
    if (stoppedHistory?.key !== key)
      stoppedHistory = {key, scope: JSON.stringify([v.bootId, v.roomId]), stationId: last.stationId,
        targetId: last.targetId, observedAt: s.observedAt, superseded: false};
    return true;
  }

  function progress(): Readonly<Origin> | null {
    const {pending, pendingScope, pendingApi, pendingControl} = get();
    return pending && current() && pendingScope === scope() && pendingApi === deps.api() ? pendingControl : null;
  }

  function pendingStart() {
    const request = get().pendingRequest;
    return progress() && request?.action === 'start' && radioStation(request.stationId) ? request : null;
  }

  function presentsPlayer() {
    const p = player();
    return p?.sourceFocused?.('radio') !== false &&
      !(knownStopped() && !pendingStart() && p?.radioHistorySuperseded?.(stoppedHistory) === true);
  }

  const ownsPlayer = () => presentsPlayer() && (hasSource() || knownStopped());

  function feedback(): {state: 'unknown' | 'error'; message: string} | null {
    const {value, unknown, message, feedbackKind} = get(), status = value?.state.status;
    if (unknown || status === 'unknown') return {state: 'unknown', message: message || UNCONFIRMED_TEXT};
    if (status === 'error' || feedbackKind === 'error') return {state: 'error', message: message || ERROR_TEXT};
    return null;
  }

  // An unconfirmed earlier action stays visible as feedback but is never replayed; a new explicit tap is a new
  // action and is allowed (R4).
  function can(action: RadioAction) {
    const v = get().value;
    return current() && !get().pending && !!v && !['preparing', 'unknown'].includes(v.state.status) &&
      v.actions.includes(action);
  }

  function displayState(): Partial<Confirmed> {
    const {value, lastConfirmed} = get(), s: Partial<RadioState> = value?.state ?? {};
    if (knownStopped())
      return {...lastConfirmed, status: 'stopped', sourceKind: 'none', ...(s.generation !== undefined
        ? {generation: s.generation} : {})};
    return !['playing', 'stopped'].includes(s.status ?? '') && lastConfirmed ? lastConfirmed : s;
  }

  // The destination of a start: the playing target, the player's chosen speaker, the explicit next, the stopped
  // radio's last target, else the default.
  function target(): RadioTarget | null {
    const v = get().value;
    if (!v || !current()) return null;
    const playing = v.state.sourceKind === 'radio' && v.state.status === 'playing';
    const actual = playing ? v.targets.find(t => t.id === v.state.targetId && usable(t)) : undefined;
    const speaker = player()?.playerSpeaker?.();
    const own = speaker ? v.targets.find(t => usable(t) && (t.id === speaker.homepodId ||
      (!!speaker.name && t.name === speaker.name))) : undefined;
    const next = v.targets.find(t => t.id === get().nextTarget && usable(t));
    // The player's chosen speaker comes before the radio's own last or default target.
    const chosen = actual ?? own ?? next;
    if (chosen) return chosen;
    const display = displayState();
    if (display.status === 'stopped' && display.targetId)
      return v.targets.find(t => t.id === display.targetId && usable(t)) ?? null;
    return v.targets.find(t => t.default && usable(t)) ?? null;
  }

  function stationChoiceScope(targetId: string | null = null): ChoiceScope | null {
    const v = get().value;
    if (!v) return null;
    const preparing = !!progress() && v.state.status === 'preparing';
    const expected = targetId ?? (preparing ? get().pendingRequest?.stationChoiceTarget : null);
    const chosen = targetId || preparing
      ? v.targets.find(row => row.id === expected && row.selectable && row.availability === 'available')
      : target();
    if (!chosen) return null;
    const api = deps.api();
    return {
      key: JSON.stringify([scope(), get().epoch, get().ownerProcessId ?? v.ownerProcessId,
        api.diagnostics?.generation(), chosen.id]),
      api,
      targetId: chosen.id,
    };
  }
  const sameStationScope = (a: ChoiceScope | null | undefined, b: ChoiceScope | null) =>
    a?.key !== undefined && a.key === b?.key && a.api === b.api;

  function canChooseStation() {
    if (can('start')) return true;
    const v = get().value;
    if (!progress() || !v || v.state.status === 'unknown') return false;
    // Native preparation withholds command offers. Keep collecting scoped input from the already admitted
    // operation; each next dispatch still needs a fresh offer.
    const canStage = v.actions.includes('start') ||
      (v.state.status === 'preparing' && get().pendingRequest?.stationChoiceAllowed === true);
    return canStage && !!stationChoiceScope();
  }

  function pendingStationChoice() {
    const scoped = stationChoiceScope();
    const latest = get().stationChoices.findLast(choice => choice.stationId &&
      sameStationScope(choice.scope, scoped));
    return latest?.stationId ?? pendingStart()?.stationId ?? null;
  }

  function observedStationId() {
    const {value, lastConfirmed} = get(), state = value?.state;
    if (!state || state.sourceKind === 'spotify') return null;
    if (knownStopped()) return displayState().stationId ?? null;
    return ['playing', 'stopped'].includes(state.status) ? state.stationId : (lastConfirmed?.stationId ?? null);
  }

  // The stopped station survives a reload like a paused song: the last confirmed station is stored.
  function storeStation(v: RadioObservation, last: Confirmed, at: number | null) {
    if (!Number.isFinite(at)) return;
    try {
      deps.storage?.()?.setItem(STATION_STORE, JSON.stringify({bootId: v.bootId, roomId: v.roomId, last, at}));
    } catch {
      /* Private mode: the station is not remembered. */
    }
  }
  function restoreStation(v: RadioObservation): Partial<RadioSourceState> {
    type Saved = {bootId?: unknown; roomId?: unknown; last?: Confirmed; at?: unknown} | null;
    const saved = ((): Saved => {
      try {
        return JSON.parse(deps.storage?.()?.getItem(STATION_STORE) ?? 'null') as Saved;
      } catch {
        return null; // An unreadable record is no record.
      }
    })();
    const last = saved?.last, s = v.state, at = saved?.at;
    if (!v.enabled || s.status !== 'stopped' || s.sourceKind !== 'none' || saved?.bootId !== v.bootId ||
      saved.roomId !== v.roomId || typeof at !== 'number' || !Number.isFinite(at) || at > now() ||
      now() - at >= STOPPED_KEEP_MS || last?.sourceKind !== 'radio' || !radioStation(last.stationId) ||
      !Number.isSafeInteger(last.generation) || last.generation > s.generation) return {};
    return {lastConfirmed: {...last}, lastConfirmedAt: at};
  }

  // Whether radio holds the speaker sheet, and closing it (after the state that released it is written).
  const sheetOwned = () => get().outputOpen || deps.outputs?.()?.radioSheet === true;
  function closeSheet(owned: boolean) {
    if (!owned) return;
    deps.outputs?.()?.closeRadioSheet();
    const dialog = deps.dialog?.();
    if (dialog?.open) dialog.close();
  }

  function closeOutputs() {
    const owned = sheetOwned();
    if (get().waitingStation !== null || get().outputOpen) set({waitingStation: null, outputOpen: false});
    closeSheet(owned);
  }

  function openOutputs() {
    player()?.focusSource?.('radio', {targetId: get().value?.state.targetId ?? null});
    deps.outputs?.()?.bindRadioClose();
    const dialog = deps.dialog?.();
    set({outputOpen: true});
    if (dialog && !dialog.open) dialog.showModal();
    void source.refresh({immediate: true}).then(() => {
      if (get().outputOpen && dialog?.open) syncOutputs();
    });
    syncOutputs();
  }

  function syncOutputs() {
    const outputs = deps.outputs?.(), dialog = deps.dialog?.();
    const {value, epoch} = get(), key = scope();
    if (!outputs || !get().outputOpen || !dialog?.open) return;
    const owned = ownsPlayer();
    const stillCurrent = () => get().outputOpen && get().epoch === epoch && get().value === value &&
      scope() === key && current() && !get().pending && !get().unknown;
    const actualRow = (row: RadioTarget) => !get().waitingStation && ownsPlayer() && value?.state.targetId === row.id &&
      value.state.status === 'playing';
    outputs.renderRadioOutputs({
      targets: value?.targets ?? [],
      actualTargetId: owned && value?.state.status === 'playing' ? value.state.targetId : null,
      lastTargetId: owned && value?.state.status !== 'playing' ? (displayState().targetId ?? null) : null,
      nextTargetId: get().nextTarget,
      message: get().unknown ? 'Radiohandlingen har ukendt udfald.' : 'Vælg højttaler til radio.',
      // Green 13/11: the current output is never locked; choosing it keeps the radio there.
      selectable: row => stillCurrent() && row.availability === 'available' && (actualRow(row) || row.selectable &&
        (get().waitingStation ? can('start') : ownsPlayer() && value?.state.status === 'playing' ? can('move')
          : can('start'))),
      onChoose: row => {
        if (!stillCurrent()) return;
        const close = () => {
          set({outputOpen: false});
          deps.dialog?.()?.close();
        };
        if (actualRow(row)) {
          player()?.chooseSpeaker?.(row);
          close();
          return;
        }
        set({nextTarget: row.id});
        player()?.chooseSpeaker?.(row);
        const station = get().waitingStation;
        set({waitingStation: null});
        close();
        if (station) void source.act('start', {stationId: station, targetId: row.id}, {kind: 'output', id: row.id});
        else if (ownsPlayer() && value?.state.status === 'playing')
          void source.act('move', {targetId: row.id}, {kind: 'output', id: row.id});
        else set({message: ''});
      },
    });
  }

  // The connection is lost (revoke: or the owner changed): every read, command and wish of the old one ends.
  function invalidate(revoke = false) {
    const owned = sheetOwned();
    const {sentOperation, value} = get();
    const next: Partial<RadioSourceState> = {epoch: get().epoch + 1, ...IDLE, stationChoices: [], waitingStation: null,
      outputOpen: false};
    if (sentOperation) Object.assign(next, {unknown: true, unknownGeneration: sentOperation.generation,
      unknownRevision: value?.revision ?? 0, unknownBoot: sentOperation.bootId, message: UNCONFIRMED_TEXT,
      sentOperation: null});
    if (value) next.value = {...value, validUntil: 0};
    read = null;
    lastRead = 0;
    clearTimeout(confirmTimer);
    settleResolve?.();
    settleResolve = null;
    clearTimeout(expiry);
    if (renewal) clearTimeout(renewal);
    renewal = null;
    if (revoke) {
      Object.assign(next, {feedbackKind: null, ownerProcessId: null, retiredOwners: [], value: null,
        lastConfirmed: null, lastConfirmedAt: null, nextTarget: null});
      if (!next.unknown && !get().unknown) next.message = '';
      stoppedHistory = null;
    }
    set(next);
    closeSheet(owned);
  }

  function scheduleRenewal(value: RadioObservation, stillCurrent: () => boolean) {
    const remaining = (value.validUntil ?? 0) * 1000 - now();
    if (remaining <= 1000 || remaining > 5000 || !current() || deps.hidden?.()) return;
    renewal = setTimeout(() => {
      renewal = null;
      // Renew by reading the current owner. The prior deadline still applies while this read is pending.
      if (stillCurrent() && get().value === value && current() && !deps.hidden?.())
        void source.refresh({immediate: true});
    }, remaining - 1000);
  }

  // A new owner process: its counters start again, and nothing of the old one may act or show.
  function ownerReplaced(next: RadioObservation) {
    const {ownerProcessId, unknown} = get();
    const retired = [...get().retiredOwners, ...(ownerProcessId ? [ownerProcessId] : [])].slice(-8);
    closeOutputs();
    clearTimeout(confirmTimer);
    settleResolve?.();
    settleResolve = null;
    stoppedHistory = null;
    player()?.forgetRadioOwner?.();
    const patch: Partial<RadioSourceState> = {feedbackKind: null, retiredOwners: retired, epoch: get().epoch + 1,
      stationChoices: [], ...IDLE, sentOperation: null, lastConfirmed: null, lastConfirmedAt: null,
      nextTarget: null};
    if (!unknown) patch.message = '';
    else {
      Object.assign(patch, {unknownGeneration: next.state.generation, unknownRevision: next.revision,
        unknownBoot: next.bootId});
      if (next.enabled && settled(next.state.status)) Object.assign(patch, {unknown: false, message: ''});
    }
    set(patch);
  }

  function admit(next: RadioObservation, stillCurrent: () => boolean) {
    const patch: Partial<RadioSourceState> = {value: next, diagnosticReadFailed: false};
    if (radioId(next.ownerProcessId)) patch.ownerProcessId = next.ownerProcessId;
    const s = next.state;
    if (next.enabled && s.sourceKind === 'radio' && ['playing', 'stopped'].includes(s.status)) {
      const lastConfirmed = {...s, targetName: next.targets.find(t => t.id === s.targetId)?.name ?? ''};
      const lastConfirmedAt = s.status === 'playing' ? now() : get().lastConfirmedAt;
      Object.assign(patch, {lastConfirmed, lastConfirmedAt});
      storeStation(next, lastConfirmed, lastConfirmedAt);
    } else if (!get().lastConfirmed) Object.assign(patch, restoreStation(next));
    const {unknown, unknownBoot, unknownGeneration, unknownRevision, nextTarget} = get();
    if (unknown && next.enabled && settled(s.status) && ((unknownBoot !== null && next.bootId !== unknownBoot) ||
      s.generation > (unknownGeneration ?? Infinity) ||
      (s.generation === unknownGeneration && next.revision > (unknownRevision ?? Infinity))))
      Object.assign(patch, {unknown: false, message: ''});
    if (nextTarget && !next.targets.some(row => row.id === nextTarget && usable(row))) patch.nextTarget = null;
    set(patch);
    clearTimeout(expiry);
    if (next.enabled)
      expiry = setTimeout(() => {
        if (stillCurrent()) set({expired: get().expired + 1});
      }, Math.max(0, (next.validUntil ?? 0) * 1000 - now()));
    scheduleRenewal(next, stillCurrent);
  }

  async function refresh({immediate = false}: {immediate?: boolean} = {}): Promise<void> {
    const api = deps.api();
    if (!deps.connection().connected) return;
    const s = snapshot();
    const owner = JSON.stringify([s?.bootId, s?.roomId]);
    if (binding !== undefined && binding !== owner) invalidate(true);
    binding = owner;
    if (read && readScope !== scope()) {
      read = null;
      set({epoch: get().epoch + 1, stationChoices: [], ...IDLE});
    }
    if (read) return read;
    if (!immediate && now() - lastRead < 5000) return;
    if (renewal) clearTimeout(renewal);
    let epoch = get().epoch;
    const key = scope();
    const trace = (code: string, fields: Record<string, unknown> = {}) => {
      record(api, 'request', {domain: 'radio', endpoint: 'radio', code, ...fields});
    };
    trace('start');
    readScope = key;
    lastRead = now();
    const stillCurrent = () => deps.api() === api && deps.connection().connected && get().epoch === epoch &&
      scope() === key;
    const pending = (async () => {
      try {
        const raw = await api.radio();
        if (!stillCurrent()) {
          trace('superseded', {current: false});
          return;
        }
        const issue = configurationReason(raw), setup = issue ? radioObservation(raw, snapshot()) : null;
        if (setup && !setup.enabled && setup.ownerProcessId === null && setup.validUntil === null &&
          setup.actions.length === 0) {
          // A negative configuration reply revokes controls without resetting the observed owner counters.
          const v = get().value;
          set({stationChoices: [], value: v?.bootId === setup.bootId && v.roomId === setup.roomId
            ? {...v, validUntil: 0, actions: [], blockedReasons: setup.blockedReasons ?? []} : setup});
          closeOutputs();
          trace(issue === 'radio_native_auth_rejected' ? 'http_denied' : 'capability_missing', {current: true});
          return;
        }
        const {value, ownerProcessId, retiredOwners} = get();
        const previous = value && radioId(ownerProcessId) ? {...value, ownerProcessId} : value;
        const next = radioObservation(raw, snapshot(), previous, now());
        if (!next || (radioId(next.ownerProcessId) && retiredOwners.includes(next.ownerProcessId)))
          throw new Error('invalid_radio');
        if (radioId(ownerProcessId) && radioId(next.ownerProcessId) && ownerProcessId !== next.ownerProcessId) {
          ownerReplaced(next);
          epoch = get().epoch;
        }
        trace(get().diagnosticReadFailed ? 'recovered' : 'ok', {current: true, source: 'podradio',
          trust: 'state_observation'});
        admit(next, stillCurrent);
      } catch (error) {
        const code = (error as {code?: unknown} | null)?.code;
        trace(!stillCurrent() ? 'superseded' : code === 'read_access_denied' ? 'http_denied'
          : code === 'read_transient' ? 'http_transient' : error instanceof TypeError ? 'network' : 'error',
        {current: stillCurrent()});
        if (!stillCurrent()) return;
        if (code === 'read_access_denied') {
          set({diagnosticReadFailed: true});
          invalidate(true);
          return;
        }
        const v = get().value;
        set({diagnosticReadFailed: true, value: v ? {...v, validUntil: 0,
          ...(configurationReason(v) ? {blockedReasons: []} : {})} : null});
      } finally {
        if (stillCurrent()) read = null;
      }
    })();
    read = pending;
    return pending;
  }

  async function choose(stationId: string, origin: Origin | null = null): Promise<void> {
    if (!radioStation(stationId) || !canChooseStation()) return;
    if (get().pending) {
      set({stationChoices: [...get().stationChoices, {stationId, origin, scope: stationChoiceScope()}]});
      return;
    }
    const v = get().value;
    if (v && hasSource() && v.state.status === 'playing' && v.state.stationId === stationId) {
      // The player shows radio again: subscribers redraw.
      if (player()?.focusSource?.('radio', {targetId: v.state.targetId})) set({});
      return;
    }
    const destination = target();
    if (!destination) {
      set({waitingStation: stationId});
      source.openOutputs();
      return;
    }
    const args = {stationId, targetId: destination.id};
    return origin ? source.act('start', args, origin) : source.act('start', args);
  }

  async function drainStationChoices() {
    while (get().stationChoices.length && !get().pending) {
      const [next, ...rest] = get().stationChoices;
      set({stationChoices: rest});
      if (!next || !sameStationScope(next.scope, stationChoiceScope())) continue;
      if (next.action === 'stop') {
        const state = get().value?.state, started = next.started, after = next.afterStart;
        if (started && after && state?.sourceKind === 'radio' && state.status === 'playing' &&
          state.generation === started.generation && state.ownerGeneration === started.ownerGeneration &&
          state.stationId === after.stationId && state.targetId === after.targetId && can('stop'))
          await source.act('stop', {}, next.origin);
      } else if (next.stationId && can('start')) {
        await source.choose(next.stationId, next.origin);
      }
    }
  }

  interface ActArgs {
    stationId?: string;
    targetId?: string;
    volumePercent?: number;
  }

  async function act(action: RadioAction, args: ActArgs = {}, origin: Origin | null = null): Promise<void> {
    const api = deps.api();
    let diagnosticRef: string | undefined;
    try {
      diagnosticRef = globalThis.crypto.randomUUID();
    } catch {
      /* Without a reference the rows are still written. */
    }
    const before = get().value;
    const diagnostic = {domain: 'radio', action, diagnosticRef, resourceId: args.targetId ?? before?.state.targetId,
      requestedValue: action === 'volume' ? args.volumePercent : action === 'stop' ? false
        : true};
    const trace = (stage: string, fields: Record<string, unknown> = {}) => {
      record(api, stage, {...diagnostic, ...fields});
    };
    trace('control_intent', {code: 'start'});
    if (!can(action) || !before) {
      trace('control_intent', {code: 'capability_missing'});
      return;
    }
    const value = before;
    const focusTicket = player()?.beginSourceFocus?.('radio', {targetId: args.targetId ?? value.state.targetId});
    const key = scope(), epoch = get().epoch, baseline = value.state.generation, s0 = value.state;
    const measuredVolume = current() && ['radio', 'spotify'].includes(s0.sourceKind ?? '') &&
      s0.targetId === args.targetId && Number.isFinite(s0.observedAt) && (s0.observedAt ?? 0) * 1000 <= now() + 5000 &&
      now() - (s0.observedAt ?? 0) * 1000 <= 30000 ? s0.volumePercent : null;
    const request: Readonly<PendingRequest> = Object.freeze({
      action,
      stationId: args.stationId ?? null,
      targetId: args.targetId ?? null,
      targetName: value.targets.find(t => t.id === args.targetId)?.name ?? '',
      volumePercent: typeof measuredVolume === 'number' && Number.isInteger(measuredVolume) ? measuredVolume : null,
      stationChoiceTarget: action === 'start' ? args.targetId : target()?.id,
      stationChoiceAllowed: value.actions.includes('start'),
    });
    const kind: Origin['kind'] = action === 'start' ? 'station' : action === 'move' ? 'output'
      : action === 'volume' ? 'volume' : 'transport';
    const control: Readonly<Origin> =
      Object.freeze(origin ?? {kind, id: args.stationId ?? args.targetId ?? 'play-pause'});
    set({pending: true, pendingControl: control, pendingRequest: request, pendingScope: key, pendingApi: api,
      pendingPhase: 'preparing', feedbackKind: null, message: '', unknown: false});
    const stillCurrent = () => deps.api() === api && deps.connection().connected && key === scope() &&
      epoch === get().epoch;
    let sent = false, rejected = false, receiptLogged = false, observationLogged = false;
    let loggedGeneration = baseline, continueStations = false;
    let observedStart: StationChoice['started'] | null = null;
    const fence = (generation: number) => ({unknown: true, unknownGeneration: generation,
      unknownRevision: value.revision, unknownBoot: value.bootId});
    const observation = (code: string, state: RadioState | undefined) => {
      observationLogged = true;
      trace('control_observation', {code, source: 'podradio', trust: 'state_observation',
        ...(current() && state ? {observedValue: action === 'volume' ? state.volumePercent
          : state.status === 'playing'} : {})});
    };
    try {
      trace('control_setup', {code: 'start'});
      const raw = await api.radioOffer({bootId: value.bootId, roomId: value.roomId, revision: value.revision, action,
        stationId: args.stationId ?? null, targetId: args.targetId ?? null, volumePercent: args.volumePercent ?? null});
      const offer = radioOfferSchema.safeParse(raw).data;
      if (!stillCurrent() || offer?.bootId !== value.bootId || offer.roomId !== value.roomId ||
        offer.expiresAt * 1000 <= now()) throw new Error('invalid_offer');
      trace('control_setup', {code: 'ok'});
      set({pendingPhase: 'sending'});
      if (!stillCurrent() || !current()) {
        trace('control_setup', {code: 'superseded', current: false});
        return;
      }
      sent = true;
      set({sentOperation: {epoch, generation: baseline, bootId: value.bootId}});
      trace('control_action', {code: 'start'});
      const receipt = await api.radioAction(offer);
      trace('control_action', {code: ['accepted', 'rejected', 'unknown'].includes(receipt.status) ? receipt.status
        : 'unknown'});
      receiptLogged = true;
      if (!stillCurrent()) return;
      if (receipt.status !== 'accepted') {
        rejected = receipt.status === 'rejected';
        set({unknown: !rejected});
        throw new Error('radio_not_accepted');
      }
      const deadline = now() + CONFIRM_WITHIN_MS;
      while (stillCurrent() && now() < deadline) {
        await source.refresh({immediate: true});
        if (!stillCurrent()) return;
        const s = get().value?.state;
        const matched = action === 'stop' ? ['stopped', 'idle'].includes(s?.status ?? '')
          : action === 'volume' ? s?.volumePercent === args.volumePercent
            : action === 'move' ? s?.status === 'playing' && s.targetId === args.targetId
              : s?.status === 'playing' && s.stationId === args.stationId && s.targetId === args.targetId;
        if (s && current() && s.generation > loggedGeneration && !['error', 'unknown'].includes(s.status)) {
          loggedGeneration = s.generation;
          trace('control_observation', {code: 'observed', source: 'podradio', trust: 'state_observation',
            observedValue: action === 'volume' ? s.volumePercent : s.status === 'playing'});
        }
        if (s && current() && s.generation > baseline &&
          (matched || ['error', 'unknown'].includes(s.status) || s.sourceKind === 'spotify')) {
          if (matched) {
            observationLogged = true;
            if (action === 'start' && s.sourceKind === 'radio')
              observedStart = {generation: s.generation, ownerGeneration: s.ownerGeneration};
          } else observation(s.status === 'unknown' ? 'unknown' : s.status === 'error' ? 'error' : 'superseded', s);
          continueStations = matched || s.status === 'error';
          set({
            ...(s.status === 'unknown'
              ? {unknown: true, unknownGeneration: s.generation, unknownRevision: get().value?.revision ?? null,
                unknownBoot: value.bootId}
              : {unknown: false}),
            message: s.status === 'unknown' ? UNCONFIRMED_TEXT : s.status === 'error' ? ERROR_TEXT : '',
          });
          return;
        }
        await new Promise<void>(resolve => {
          settleResolve = resolve;
          confirmTimer = setTimeout(resolve, CONFIRM_READ_MS);
        });
      }
      observation('unconfirmed', get().value?.state);
      set({...fence(baseline), message: UNCONFIRMED_TEXT});
    } catch {
      if (sent && !receiptLogged) trace('control_action', {code: 'unknown'});
      if (!sent) trace('control_setup', {code: stillCurrent() ? 'rejected' : 'superseded', current: stillCurrent()});
      if (stillCurrent()) {
        if (sent && !rejected) set(fence(baseline));
        const unknown = get().unknown;
        if (!unknown) {
          continueStations = true;
          player()?.finishSourceFocus?.(focusTicket as never, 'rejected');
        }
        set({feedbackKind: unknown ? 'unknown' : 'error', message: unknown ? UNCONFIRMED_TEXT
          : action === 'stop' ? (sent ? 'Radio kunne ikke stoppes.' : 'Stop blev ikke sendt.')
            : action === 'volume' ? 'Lydstyrken blev ikke ændret.' : 'Radio kunne ikke startes. Prøv igen.'});
      }
    } finally {
      if (sent && !observationLogged && !rejected)
        observation(stillCurrent() ? 'unconfirmed' : 'superseded', undefined);
      if (epoch === get().epoch) {
        const patch: Partial<RadioSourceState> = {sentOperation: null, ...IDLE};
        if (!stillCurrent() && sent) Object.assign(patch, fence(baseline), {message: UNCONFIRMED_TEXT});
        // A waiting Stop belongs to this start's confirmed station, never the previous one.
        let choices = get().stationChoices.flatMap(choice => {
          if (choice.afterStart !== request) return [choice];
          return observedStart ? [{...choice, started: observedStart}] : [];
        });
        const spotifyTookOver = value.state.sourceKind !== 'spotify' && get().value?.state.sourceKind === 'spotify';
        const unknown = patch.unknown ?? get().unknown;
        const drain = stillCurrent() && continueStations && !unknown && !spotifyTookOver && choices.length > 0;
        if (!drain) choices = [];
        set({...patch, stationChoices: choices});
        if (drain) await drainStationChoices();
      }
    }
  }

  // The player's controls while radio owns it: Stop/Start and the volume.
  function control(event: {type: string; value?: unknown; controlId?: string}): Promise<void> | undefined {
    if (event.type === 'toggle') {
      const origin: Origin = {kind: 'transport', id: event.controlId ?? 'play-pause'};
      // A waiting Stop belongs to this start's confirmed station, never the previous one.
      const start = pendingStart();
      if (start) {
        if (!get().stationChoices.some(choice => choice.afterStart === start))
          set({stationChoices: [...get().stationChoices, {action: 'stop', origin,
            scope: stationChoiceScope(start.targetId), afterStart: start}]});
        return;
      }
      // Stop is always pressable: during a volume command it wins and is sent as soon as that settles.
      if (get().pending && get().pendingRequest?.action === 'volume') {
        set({stopWish: origin, volumeWish: null});
        return;
      }
      const display = displayState();
      if (display.status === 'playing') return source.act('stop', {}, origin);
      if (display.stationId) return source.choose(display.stationId, origin);
      return;
    }
    if (event.type !== 'volume') return;
    // The slider keeps the chosen value; changes during a sent volume are coalesced to the last one.
    const percent = Number(event.value);
    if (get().pending && get().pendingRequest?.action === 'volume') {
      set({volumeWish: percent});
      return;
    }
    return (async () => {
      let next: number | null = percent;
      while (next !== null && Number.isInteger(next)) {
        set({volumeWish: null, volumeTarget: next});
        await source.act('volume', {volumePercent: next});
        set({volumeTarget: null});
        const stop = get().stopWish;
        if (stop) {
          set({stopWish: null, volumeWish: null});
          if (displayState().status === 'playing') await source.act('stop', {}, stop);
          return;
        }
        next = get().feedbackKind ? null : get().volumeWish;
        if (next === get().value?.state.volumePercent) next = null;
      }
      set({volumeWish: null});
    })();
  }

  function controls(): RadioControls {
    const request = pendingStart();
    if (request) {
      // The start stays tappable: the toggle queues Stop and shows that wish at once.
      const stopping = get().stationChoices.some(choice => choice.afterStart === request);
      return {sourceKind: 'radio', playing: !stopping, loadingControlId: 'play-pause',
        pendingLabel: stopping ? 'Stopper radio…' : `Starter ${radioStation(request.stationId)?.label ?? ''}…`,
        blocked: false, toggle: true, volume: request.volumePercent, canVolume: false};
    }
    const {value, pending, pendingRequest, stopWish, volumeWish, volumeTarget} = get();
    const s = value?.state, display = displayState(), wish = volumeWish ?? volumeTarget;
    const volume = knownStopped() ? null : Number.isInteger(wish) ? wish : (s?.volumePercent ?? null);
    // A volume command in flight never greys the slider or Stop (same as Spotify volume).
    const busy = pending && pendingRequest?.action !== 'volume', stopWished = !!stopWish && current();
    const ready = current() && !busy && !['preparing', 'unknown'].includes(s?.status ?? '');
    const actions = value?.actions ?? [];
    const running = progress();
    return {sourceKind: 'radio',
      loadingControlId: stopWished ? 'play-pause' : running?.kind === 'transport' ? running.id : null,
      ...(stopWished ? {pendingLabel: 'Stopper radio…'} : {}),
      playing: display.status === 'playing',
      toggle: ready && actions.includes(display.status === 'playing' ? 'stop' : 'start'),
      blocked: !current() || busy,
      volume: Number.isInteger(volume) ? volume : null,
      canVolume: !knownStopped() && !stopWish && ready && actions.includes('volume')};
  }

  function playerModel(): RadioPlayerModel | null {
    const request = pendingStart();
    if (request) {
      const station = radioStation(request.stationId);
      if (!station) return null;
      // Requested playback is presentation only; it never replaces an observation.
      return {active: true, sourceKind: 'radio', playing: false, fresh: false, loading: true, title: station.label,
        artist: 'Direkte radio', fixtureArt: `assets/radio-${station.id}.svg`, target: request.targetName,
        volume: request.volumePercent, canOutput: false, canDiscover: false, canSeek: false,
        feedback: {message: `Starter ${station.label}…`, pending: true}};
    }
    const value = get().value;
    if (!value || (!hasSource() && !knownStopped())) return null;
    const s = value.state, display = displayState(), stopped = knownStopped();
    const station = radioStation(display.stationId) ?? radioStation(s.stationId);
    if (!station) return null;
    const target = value.targets.find(t => t.id === display.targetId);
    return {active: true, sourceKind: 'radio', playing: display.status === 'playing',
      fresh: current() && !stopped && ['playing', 'stopped'].includes(s.status), title: station.label,
      artist: 'Direkte radio', fixtureArt: `assets/radio-${station.id}.svg`,
      target: target?.name ?? display.targetName ?? '', volume: stopped ? null : (s.volumePercent ?? null),
      canOutput: current(), canDiscover: true, canSeek: false, controlStatus: '', feedback: feedback()};
  }

  const renderControls = () => {
    player()?.renderControls(controls());
  };

  function renderPlayer() {
    const shared = player();
    if (!shared || !presentsPlayer()) return false;
    const model = playerModel();
    if (!model) return false;
    shared.renderPlayer(model);
    renderControls();
    shared.renderQueue([], {sourceKind: 'radio'});
    return true;
  }

  // The radio feedback the shell shows (one source-scoped notice), only for this boot and room.
  function notice() {
    const {value, unknown, feedbackKind, lastConfirmed} = get();
    const shown = !!value && sameOwner(value) && (unknown || !!feedbackKind || (value.enabled &&
      (value.state.sourceKind === 'radio' || lastConfirmed?.sourceKind === 'radio')));
    return shown ? feedback() : null;
  }

  const source = Object.assign(store, {
    scope, setupIssue, targetName, current, hasSource, knownStopped, presentsPlayer, ownsPlayer, progress,
    pendingStart, feedback, can, displayState, target, stationChoiceScope, canChooseStation, pendingStationChoice,
    observedStationId, refresh, invalidate, choose, act, control, controls, playerModel, renderControls,
    renderPlayer, notice, openOutputs, closeOutputs, syncOutputs, drainStationChoices,
    stoppedHistory: () => stoppedHistory,
    cleanup: () => {
      invalidate(true);
    },
  });
  return source;
}

export type RadioSource = ReturnType<typeof createRadioSource>;
