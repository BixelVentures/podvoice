// Bil's state outside React: what the screen is told (input), the car it shows (model) and the command lifecycles.
// One Zustand store per screen; the app has one (state.ts), each test makes its own.
//
// Live commands (an observed car): a tap asks the owner for a setup (onVehicleSetup); a proposal that requires
// confirmation, can wake the car or needs an override opens the dialog with exactly what will happen (effects, wake,
// earlier unresolved requests, override); only the confirmation sends (onVehicleSend). The command is then
// observing: the car's answer is a newer observation of its field (with HA/screen clock skew allowed); a contrary
// fresh observation after the wait says what the car did not do; otherwise the outcome is an honest UNKNOWN. A late
// receipt (the screen changed) shows UNKNOWN only while the same presentation is current. Nothing is ever resent.
// One command per family (lock, trunk, climate); the family's controls are blocked while it is sending/observing.
//
// Local preview (a fixture with preview controls): explicit intents, confirmed where the car would act, handed to
// onAction (the local preview command); never sent to a car. Its result counts only for the exact next revision.
//
// The rules are those of the previous controller (VehicleView), kept 1:1; what each element shows is a pure function
// of this state (presentation.ts).
import {createStore} from 'zustand/vanilla';
import type {StoreApi} from 'zustand/vanilla';
import {
  unconnectedVehicleModel,
  vehicleChargeUpdate,
  vehicleModel,
} from './model';
import type {ChargeContext, ChargePresentation, FixtureSeats, PreviewEvent, VehicleModel} from './model';
import type {VehicleOperation, VehicleProposal, VehicleSendResult} from './live';
import {
  ACTION_FIELDS,
  CLIMATE_ACTIONS,
  CLOCK_SKEW_S,
  ERROR_TEXTS,
  LEVELS,
  LIVE_EFFECTS,
  NOT_DONE,
  PRIOR_NAMES,
  SEATS,
  SEAT_LEVELS,
  SEAT_NAMES,
  UNKNOWN_OUTCOME,
  UNLOCK_CONSEQUENCE,
  UNLOCK_TITLE,
  actionFamily,
  actionNote,
  climateDependents,
  fieldValue,
  finite,
  historicalField,
  idempotentActions,
  isSeatControl,
  liveClimateActive,
  lowBattery,
  namedButton,
  seatControl,
  seatHeat,
  text,
} from './rules';
import type {Control, Family, NoteKey, PressControl, Seat} from './rules';

type Args = Record<string, unknown>;
export type NoteState = 'ready' | 'unknown' | 'error' | 'pending';

export interface Note {
  text: string;
  state: NoteState | undefined;
}

export interface LiveCommand {
  id: number;
  family: Family;
  operation: VehicleOperation;
  trigger: Control | null;
  action: string;
  args: Args;
  field: string | undefined;
  expected: unknown;
  label: string;
  confirmation: string;
  previousAt: number;
  sentAt: number;
  phase: 'sending' | 'observing' | 'unknown';
  note: NoteKey;
  awaitingCar: boolean;
  contradicted: boolean;
}

export interface Feedback {
  command: LiveCommand;
  state: 'ready' | 'unknown' | 'error';
  text: string;
}

export interface PendingPreview {
  trigger: Control | null;
  label: string;
  revision: number | undefined;
  controller: AbortController;
  phase?: 'waking' | 'awaiting';
}

export interface Draft {
  temperatureC: number | null | undefined;
  seats: Partial<FixtureSeats>;
}

// The dialog's content; it stays after the dialog closes, as before.
export interface DialogContent {
  title: string;
  note: string;
  confirmLabel: string;
  confirmIcon: string | undefined;
  confirmTone: 'danger' | 'warning' | 'neutral';
  cancelIcon: string | undefined;
}

// What the shell tells the screen on each render.
export interface VehicleInput {
  value: unknown;
  connected: boolean;
  connectionDetail: string | null;
  chargeContext: ChargeContext | undefined;
  vehicleActions: string[];
  feedbackScope: string | null;
}

export interface VehicleRenderOptions {
  connected?: boolean;
  connectionDetail?: string | null;
  chargeContext?: ChargeContext | undefined;
  vehicleActions?: unknown;
  feedbackScope?: string | null;
}

export interface PreviewProgress {
  phase?: string;
}

// What the screen asks of its owners (the shell binds the live owner and the local preview command).
export interface VehiclePorts {
  onAction: (
    event: PreviewEvent,
    options: {signal: AbortSignal; onProgress: (progress?: PreviewProgress) => void},
  ) => unknown;
  onVehicleSetup: (
    action: string,
    args: Args,
    presented: () => boolean,
  ) => Promise<VehicleProposal | null | undefined> | VehicleProposal | null | undefined;
  onVehicleSend: (operation: VehicleOperation) => Promise<VehicleSendResult | undefined> | VehicleSendResult | undefined;
  onVehicleCancel: (operation?: VehicleOperation) => void;
}

export interface VehicleState {
  input: VehicleInput;
  model: VehicleModel;
  // A configured car whose state is not known (read granted for the current scope, nothing observed).
  configuredUnavailable: boolean;
  draft: Draft | undefined;
  draftRevision: number | undefined;
  unknownRevision: number | null | undefined;
  charge: ChargePresentation | null;
  // Grows by one for each finite charge acknowledgement; the meter plays it.
  chargeCue: number;
  artwork: boolean;
  imageState: 'ready' | 'missing' | 'unavailable' | undefined;
  notes: Record<NoteKey, Note>;
  // The notes the live feedback wrote (cleared when its last entry goes).
  feedbackNotes: Record<NoteKey, boolean>;
  commands: Partial<Record<Family, LiveCommand>>;
  // Insertion-ordered, one per family.
  feedback: Feedback[];
  // A setup or a send is running (vehiclePending); `setupTrigger` shows the setup's progress on its control.
  busy: boolean;
  setupTrigger: Control | null;
  proposal: {proposal: VehicleProposal; trigger: Control | null} | null;
  confirm: {intent: PreviewEvent; trigger: Control | null; revision: number | undefined} | null;
  dialogOpen: boolean;
  dialog: DialogContent | null;
  preview: PendingPreview | null;
  commandResult: 'confirmed' | 'failed' | 'unknown' | null;
  commandTarget: Control | null;
  commandNote: NoteKey;
  seatExpanded: boolean;
  // A request to move focus to a control (the dialog's trigger after it closes).
  focus: {control: Control; seq: number} | null;
  disposed: boolean;
}

export interface VehicleActions {
  render: (value?: unknown, options?: VehicleRenderOptions) => VehicleModel;
  // Re-applies the controls' rules to the current state (the old renderControls).
  refresh: () => void;
  control: (control: PressControl) => void;
  seatChange: (seat: Seat, level: number) => void;
  toggleSeats: () => void;
  beginVehicle: (action: string, trigger: Control | null, args?: Args) => Promise<void>;
  finishVehicle: (proposal: VehicleProposal, trigger: Control | null) => Promise<void>;
  requestConfirmation: (intent: PreviewEvent, trigger: Control | null) => void;
  dismissConfirmation: (options?: {restoreFocus?: boolean; resetDraft?: boolean}) => void;
  // The native dialog closed by itself (Escape, a form) or was cancelled.
  dialogClosed: () => void;
  sendAction: (event: PreviewEvent, trigger: Control | null) => void;
  imageLoaded: () => void;
  imageFailed: () => void;
  // The page is left: a live proposal is cancelled, the dialog closes without moving focus, charge cues stop.
  leave: () => void;
  // The screen is dropped: in-flight work is ignored and nothing acts again.
  dispose: () => void;
  // A new screen life after a dispose (the shell is attached again): fresh state; older work never acts on it.
  reset: () => void;
  // The charge acknowledgement in flight (played by the meter), cancelled by a newer reading or by leaving.
  setChargeAnimation: (animation: Animation | null | undefined) => void;
  chargeAnimation: () => Animation | null;
  liveCommand: (family: Family) => LiveCommand | undefined;
  hasDraft: () => boolean;
}

export type VehicleStore = StoreApi<VehicleState & VehicleActions>;

const NO_SEATS: FixtureSeats = {driver: 0, passenger: 0};
const emptyNote = (): Note => ({text: '', state: undefined});
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as {then?: unknown} | null | undefined)?.then === 'function';
const DEFAULT_INPUT: VehicleInput = {
  value: undefined,
  connected: true,
  connectionDetail: null,
  chargeContext: undefined,
  vehicleActions: [],
  feedbackScope: null,
};

// Deep equality of the store's data (functions and controllers by identity), so an identical render notifies nobody.
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const left = a as Record<string | symbol, unknown>;
  const right = b as Record<string | symbol, unknown>;
  const keys = Reflect.ownKeys(left);
  if (keys.length !== Reflect.ownKeys(right).length) return false;
  return keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}

// Whether the store's controls are live (an observed car, connected, not disposed).
export const liveEnabled = (state: VehicleState) =>
  state.model.mode === 'observed' && state.input.connected !== false && !state.disposed;
// A local fixture with preview controls.
export const previewEnabled = (state: VehicleState) =>
  state.model.mode === 'fixture' && state.model.controlsPreview === true;
export const controlsEnabled = (state: VehicleState) =>
  previewEnabled(state) &&
  state.input.connected !== false &&
  !state.disposed &&
  !state.preview &&
  state.unknownRevision !== state.model.revision;
export const settingsEnabled = (state: VehicleState) =>
  controlsEnabled(state) && state.model.climate.status !== 'off';
export const offered = (state: VehicleState, action: string) => state.input.vehicleActions.includes(action);
export const actionBlocked = (state: VehicleState, action: string) => {
  const phase = state.commands[actionFamily(action)]?.phase;
  return state.busy || phase === 'sending' || phase === 'observing';
};
// The one defrost control: live, it follows the observed state and the offered action; in the preview, the climate.
export const defrostDisabled = (s: VehicleState) => {
  const m = s.model;
  if (liveEnabled(s)) {
    if (!['defrostOn', 'defrostOff'].some(action => offered(s, action))) return !controlsEnabled(s);
    const action = m.climate.defrost === true ? 'defrostOff' : m.climate.defrost === false ? 'defrostOn' : null;
    return (
      !liveClimateActive(m) ||
      !action ||
      !!m.stale ||
      (m.historicalFields ?? []).includes('climate.defrost') ||
      !offered(s, action) ||
      actionBlocked(s, 'climateOn')
    );
  }
  return previewEnabled(s) ? !settingsEnabled(s) : !controlsEnabled(s);
};
export const seatsDisabled = (state: VehicleState) =>
  previewEnabled(state) ? state.model.climate.status === 'off' : !liveClimateActive(state.model);

export function createVehicleStore(ports: Partial<VehiclePorts> = {}): VehicleStore {
  const onAction = ports.onAction ?? (() => undefined);
  const onVehicleSetup = ports.onVehicleSetup ?? (async () => Promise.resolve(null));
  const onVehicleSend = ports.onVehicleSend ?? (async () => Promise.resolve({status: 'failed'}));
  const onVehicleCancel = ports.onVehicleCancel ?? (() => undefined);
  // Not data: the observation waits' cancellers by command id, and the charge animation.
  const observationWaits = new Map<number, (() => void) | null | undefined>();
  let animation: Animation | null = null;
  let commandIds = 0;
  let focusSeq = 0;
  // A screen life: a reset starts a new one, and work begun in an older life never acts on the new one.
  let life = 0;

  const store = createStore<VehicleState & VehicleActions>()((set, get) => {
    // One step: a working copy is changed by the old controller's rules and committed once, only if it differs.
    type W = VehicleState;
    const step = <T>(change: (w: W) => T): T => {
      const prev = get();
      const w: W = {
        ...prev,
        notes: {access: {...prev.notes.access}, climate: {...prev.notes.climate}},
        feedbackNotes: {...prev.feedbackNotes},
        commands: {...prev.commands},
        feedback: [...prev.feedback],
        draft: prev.draft ? {...prev.draft, seats: {...prev.draft.seats}} : prev.draft,
      };
      const result = change(w);
      const changed = (Object.keys(w) as (keyof W)[]).some(key => !same(prev[key], w[key]));
      if (changed) set(w);
      return result;
    };
    const current = (w: W, command: LiveCommand) => w.commands[command.family]?.id === command.id;
    const draftOf = (model: VehicleModel): Draft => ({
      temperatureC: model.climate.targetTemperatureC,
      seats: {...model.climate.seats},
    });
    const cancelAnimation = () => {
      animation?.cancel();
      animation = null;
    };

    // ---- Confirmation ----

    const dismiss = (w: W, {restoreFocus = true, resetDraft = true} = {}) => {
      if (resetDraft && !w.preview) w.draft = draftOf(w.model);
      const trigger = w.confirm?.trigger ?? null;
      w.confirm = null;
      if (w.dialogOpen) {
        w.dialogOpen = false;
        // Closing the dialog cancels a live proposal that was not confirmed.
        if (w.proposal) {
          onVehicleCancel(w.proposal.proposal.operation);
          w.proposal = null;
        }
      }
      if (restoreFocus && !w.disposed && trigger) w.focus = {control: trigger, seq: ++focusSeq};
    };

    const requestConfirmation = (w: W, intent: PreviewEvent, trigger: Control | null) => {
      if (!controlsEnabled(w)) return;
      const model = w.model;
      w.confirm = {intent, trigger, revision: model.revision};
      const trunk = intent.action === 'rear-trunk';
      const access = trunk || intent.action === 'lock';
      const settings = intent.action === 'climate-settings';
      const climate = intent.action === 'climate';
      const temperature = String(intent.temperatureC);
      const label = trunk
        ? intent.value === 'open'
          ? 'Åbn bagagerum'
          : 'Luk bagagerum'
        : access
          ? 'Lås op'
          : settings
            ? intent.setting === 'temperature'
              ? `Indstil ${temperature} °C`
              : 'Indstil'
            : climate
              ? intent.value
                ? 'Tænd klima'
                : 'Sluk klima'
              : intent.value
                ? 'Afrim ruder'
                : 'Stop afrimning';
      const title = trunk
        ? intent.value === 'open'
          ? 'Åbn bagagerummet?'
          : 'Luk bagagerummet?'
        : access
          ? UNLOCK_TITLE
          : settings
            ? intent.setting === 'temperature'
              ? `Indstil ${temperature} °C?`
              : 'Indstil sædevarme?'
            : label + '?';
      const seats = intent.seats ?? NO_SEATS;
      const startsClimate = model.climate.status === 'off' && Object.values(seats).some(value => value > 0);
      const note = trunk
        ? 'Se til bilen, og hold området ved bagagerummet frit.'
        : access
          ? UNLOCK_CONSEQUENCE
          : settings
            ? `${temperature} °C · Fører: ${LEVELS[seats.driver] ?? 'undefined'} · Passager: ` +
              `${LEVELS[seats.passenger] ?? 'undefined'}.` +
              (startsClimate ? ' Klima tændes samtidig.' : '')
            : climate
              ? intent.value
                ? `Kabineklima tændes ved ${String(model.climate.targetTemperatureC)} °C.`
                : 'Kabineklima slukkes.'
              : intent.value
                ? 'Maksimal afrimning tændes. Det øger klimaanlæggets energiforbrug.'
                : 'Maksimal afrimning stoppes.';
      const icon = trunk ? 'car-front' : access ? 'lock-open' : climate ? 'power' : 'wind';
      w.dialog = {
        title,
        note,
        confirmLabel: label,
        confirmIcon: `assets/icons/${icon}.svg`,
        confirmTone: intent.action === 'lock' ? 'danger' : access ? 'warning' : 'neutral',
        cancelIcon: 'assets/icons/x-lg.svg',
      };
      w.dialogOpen = true;
    };

    // A live proposal is confirmed in the dialog, with the wake and earlier unresolved requests disclosed.
    const propose = (w: W, proposal: VehicleProposal, trigger: Control | null) => {
      const c = proposal.confirmation;
      const args = c.args ?? {};
      w.proposal = {proposal, trigger};
      const unlocking = c.action === 'unlock';
      const label = c.label ?? 'undefined';
      const requested =
        c.action === 'temperature'
          ? `${label}: ${String(args.temperature).replace('.', ',')} °C`
          : ['driverSeatHeat', 'passengerSeatHeat'].includes(c.action)
            ? `${label}: ${SEAT_NAMES[String(args.option)] ?? 'undefined'}`
            : label;
      const priorUnresolved = c.priorUnresolved ?? {access: [], climate: []};
      const extraPrior = Object.entries(priorUnresolved)
        .filter(([key, values]) => !['access', 'climate'].includes(key) && values.length)
        .map(([key]) => PRIOR_NAMES[key])
        .filter((name): name is string => !!name);
      const prior = [
        ...extraPrior,
        ...priorUnresolved.access.map(v => (v === 'locked' ? 'låse bilen' : 'låse bilen op')),
        ...priorUnresolved.climate.map(v => (v === 'on' ? 'tænde klimaet' : 'slukke klimaet')),
      ];
      const priorText = prior.length > 1 ? `${prior.slice(0, -1).join(', ')} og ${prior.at(-1) ?? ''}` : prior[0];
      const effect = (value: string) => c.effects?.some(([family, v]) => family === 'climate' && v === value);
      const note = [
        unlocking ? UNLOCK_CONSEQUENCE : '',
        c.nativeWakePossible ? 'Handlingen kan vække bilen.' : '',
        effect('on') && ['driverSeatHeat', 'passengerSeatHeat', 'defrostOn'].includes(c.action)
          ? 'Handlingen kan tænde klimaet.'
          : '',
        effect('off') && c.action === 'defrostOff' ? 'Handlingen kan slukke klimaet.' : '',
        prior.length ? `Tidligere anmodninger om at ${priorText ?? ''} kan stadig blive udført senere.` : '',
        c.requiresOverride ? 'Bekræft, at du vil fortsætte.' : '',
      ]
        .filter(Boolean)
        .join(' ');
      w.dialog = {
        title: unlocking ? UNLOCK_TITLE : requested + '?',
        note,
        confirmLabel: c.label ?? '',
        confirmIcon: undefined,
        confirmTone: unlocking ? 'danger' : 'neutral',
        cancelIcon: undefined,
      };
      w.dialogOpen = true;
    };

    // ---- Live commands ----

    const clearCommand = (w: W, command: LiveCommand) => {
      observationWaits.get(command.id)?.();
      observationWaits.delete(command.id);
      if (current(w, command)) delete w.commands[command.family];
    };

    const finishFeedback = (w: W, command: LiveCommand, state: Feedback['state'], value: string) => {
      clearCommand(w, command);
      const kept = state === 'unknown' ? {...command, phase: 'unknown' as const} : command;
      if (state === 'unknown') w.commands[command.family] = kept;
      if (command.operation.presentationCurrent) {
        w.feedback = [...w.feedback.filter(row => row.command.family !== command.family), {command: kept, state, text: value}];
      }
      w.notes[command.note] = {text: value, state};
    };

    const observedSince = (w: W, command: LiveCommand): boolean => {
      if (!command.field || w.model.mode !== 'observed') return false;
      const observedAt = w.model.fieldObservedAt?.[command.field];
      return (
        !historicalField(w.model, command.field, w.input.connected) &&
        finite(observedAt) &&
        observedAt > command.previousAt &&
        observedAt >= command.sentAt - CLOCK_SKEW_S
      );
    };

    const observationMatches = (w: W, command: LiveCommand): boolean => {
      const read = LIVE_EFFECTS[command.action]?.read;
      if (
        !read ||
        !command.field ||
        w.model.mode !== 'observed' ||
        (command.operation.observationCurrent && !command.operation.observationCurrent())
      ) {
        return false;
      }
      return observedSince(w, command) && read(w.model) === command.expected;
    };

    // Basis for a concrete result: the car is not asleep/offline and a fresh known value newer than the command
    // differs from the target. Otherwise null ("Udfald ukendt").
    const contradiction = (w: W, command: LiveCommand): string | null => {
      const m = w.model;
      const notDone = NOT_DONE[command.action];
      if (
        !notDone ||
        !LIVE_EFFECTS[command.action] ||
        !command.field ||
        m.mode !== 'observed' ||
        m.stale ||
        ['asleep', 'offline'].includes(m.connectionState ?? '') ||
        (command.operation.observationCurrent && !command.operation.observationCurrent()) ||
        !observedSince(w, command) ||
        fieldValue(m, command.field) == null ||
        observationMatches(w, command)
      ) {
        return null;
      }
      const battery = command.family === 'climate' ? lowBattery(m) : null;
      return (text(notDone, command.args) ?? '') + (battery === null ? '' : ` · batteri ${String(battery)} %`);
    };

    const reconcileCommand = (w: W, command: LiveCommand) => {
      if (command.operation.presentationCurrent && !command.operation.presentationCurrent()) {
        w.notes[command.note] = {...w.notes[command.note], text: ''};
        clearCommand(w, command);
        return;
      }
      if (command.phase !== 'sending' && observationMatches(w, command)) {
        finishFeedback(w, command, 'ready', command.confirmation);
      }
    };

    const renderFeedback = (w: W) => {
      for (const entry of [...w.feedback]) {
        const {command, state} = entry;
        const drop = () => {
          w.feedback = w.feedback.filter(row => row !== entry);
        };
        if (!command.operation.presentationCurrent?.() || (state === 'ready' && !observationMatches(w, command))) {
          drop();
          continue;
        }
        // The car did what was asked after all: the contradiction no longer holds.
        if (command.contradicted && observationMatches(w, command)) {
          drop();
          continue;
        }
        // A newer observation of the field is the car's answer: "Udfald ukendt" has served its purpose.
        if (state === 'unknown' && observedSince(w, command)) {
          drop();
          const live = w.commands[command.family];
          if (live?.id === command.id) clearCommand(w, live);
        }
      }
      const labels: Record<Family, string> = {lock: 'Lås', trunk: 'Bagagerum', climate: 'Klima'};
      for (const key of ['access', 'climate'] as const) {
        const entries = w.feedback.filter(row => row.command.note === key);
        if (!entries.length) {
          if (w.feedbackNotes[key]) {
            w.feedbackNotes[key] = false;
            w.notes[key] = {...w.notes[key], text: ''};
          }
          continue;
        }
        w.feedbackNotes[key] = true;
        const issues = entries.filter(row => row.state === 'unknown' || row.state === 'error');
        const last = entries.at(-1);
        const active = issues.length ? issues : last ? [last] : [];
        const first = active[0];
        if (!first) continue;
        w.notes[key] = {
          state: active.some(row => row.state === 'unknown') ? 'unknown' : first.state,
          text: active.length === 1 ? first.text : active.map(row => labels[row.command.family] + ': ' + row.text).join(' '),
        };
      }
    };

    // The controls' rules after each change (the old renderControlStates' lasting effects).
    const settle = (w: W) => {
      const m = w.model;
      const enabled = previewEnabled(w);
      const pending = !!w.preview;
      if (!w.proposal && (!enabled || w.input.connected === false || w.confirm?.revision !== m.revision) && !pending) {
        dismiss(w);
      }
      if (seatsDisabled(w)) w.seatExpanded = false;
      renderFeedback(w);
      if (liveEnabled(w)) {
        for (const command of Object.values(w.commands)) {
          if (command.phase === 'unknown' || namedButton(command.trigger)) continue;
          w.notes[command.note] = {state: 'pending', text: command.label};
        }
      }
      if (!enabled) {
        w.commandResult = null;
        return;
      }
      for (const key of ['access', 'climate'] as const) {
        if (key !== w.commandNote) w.notes[key] = {...w.notes[key], text: ''};
      }
      const unknown = w.unknownRevision === m.revision;
      const preview = w.preview;
      const inline = isSeatControl(preview?.trigger);
      w.notes[w.commandNote] = {
        state: pending ? 'pending' : w.commandResult === 'failed' ? 'error' : unknown ? 'unknown' : 'ready',
        text:
          preview && inline
            ? `${preview.label} · ${preview.phase === 'waking' ? 'vækker bilen…' : 'afventer svar…'}`
            : unknown
              ? 'Svar mangler · Kontrollér bilen før en ny kommando.'
              : w.commandResult === 'failed'
                ? 'Afvist · Prøv igen.'
                : '',
      };
    };

    const renderModel = (w: W, value: unknown, options: VehicleRenderOptions) => {
      const {
        connected = true,
        connectionDetail = null,
        chargeContext,
        vehicleActions = [],
        feedbackScope = null,
      } = options;
      if (w.input.feedbackScope !== feedbackScope) {
        w.notes = {access: {...w.notes.access, text: ''}, climate: {...w.notes.climate, text: ''}};
      }
      w.input = {
        value,
        connected,
        connectionDetail,
        chargeContext,
        vehicleActions: Array.isArray(vehicleActions) ? (vehicleActions as string[]) : [],
        feedbackScope,
      };
      const model = vehicleModel(value);
      w.configuredUnavailable =
        model.mode === 'unconnected' &&
        chargeContext?.readGranted === true &&
        typeof chargeContext.scope === 'string' &&
        chargeContext.scope !== '' &&
        chargeContext.scope !== 'local' &&
        chargeContext.scope === chargeContext.sourceScope;
      if (!w.draft || w.draftRevision !== model.revision) {
        w.draft = draftOf(model);
        w.draftRevision = model.revision;
        if (w.unknownRevision !== model.revision) w.unknownRevision = null;
      }
      w.model = same(w.model, model) ? w.model : model;
      for (const command of Object.values(w.commands)) reconcileCommand(w, command);
      // Live artwork is a generic illustration only for a verified model; leaving it forgets the image's state.
      const artwork =
        model.modelName === 'Model Y' &&
        (model.mode === 'observed' || (model.mode === 'fixture' && model.modelYear === 2023));
      if (!artwork && w.artwork) w.imageState = 'unavailable';
      w.artwork = artwork;
      const charge = vehicleChargeUpdate(w.charge, model, chargeContext);
      w.charge = charge;
      if (charge.cancel || charge.cue) cancelAnimation();
      if (charge.cue) w.chargeCue++;
      settle(w);
      return w.model;
    };

    // ---- Local preview ----

    const sendPreview = (event: PreviewEvent, trigger: Control | null) => {
      const ready = step(w => {
        if (!controlsEnabled(w) || w.preview) return null;
        const seat = isSeatControl(trigger) ? (trigger.split(':')[1] as Seat) : undefined;
        const level = seat ? (LEVELS[event.seats?.[seat] ?? -1] ?? 'undefined') : '';
        const label = seat
          ? `${seat === 'driver' ? 'Fører' : 'Passager'}: ${level}`
          : Number.isInteger(event.temperatureC)
            ? `${String(event.temperatureC)} °C`
            : '';
        const operation: PendingPreview = {trigger, label, revision: event.revision, controller: new AbortController()};
        w.preview = operation;
        w.commandNote = trigger === 'lockButton' || trigger === 'rearTrunkButton' ? 'access' : 'climate';
        w.commandResult = null;
        settle(w);
        return operation;
      });
      if (!ready) return;
      const operation = ready;
      const progress = ({phase}: PreviewProgress = {}) => {
        step(w => {
          if (w.preview?.controller !== operation.controller || w.disposed) return;
          w.preview = {...w.preview, phase: phase === 'waking' ? 'waking' : 'awaiting'};
          settle(w);
        });
      };
      let result: unknown;
      try {
        result = onAction(event, {signal: operation.controller.signal, onProgress: progress});
      } catch {
        result = {status: 'unknown'};
      }
      const finish = (outcome: {status?: string; revision?: number} | undefined) => {
        step(w => {
          if (w.preview?.controller !== operation.controller || w.disposed) return;
          w.preview = null;
          const model = w.model;
          const sameRevision = model.mode === 'fixture' && model.revision === operation.revision;
          const confirmed =
            outcome?.status === 'confirmed' &&
            outcome.revision === model.revision &&
            model.revision === (operation.revision ?? NaN) + 1;
          if (!sameRevision && !confirmed) {
            w.commandResult = null;
            dismiss(w);
            settle(w);
            return;
          }
          w.commandTarget = trigger;
          w.commandResult = confirmed ? 'confirmed' : outcome?.status === 'failed' ? 'failed' : 'unknown';
          if (w.commandResult === 'unknown') w.unknownRevision = operation.revision;
          dismiss(w);
          settle(w);
        });
      };
      // A synchronous legacy preview callback is not proof of a vehicle outcome.
      if (isThenable(result)) {
        result.then(
          value => {
            finish(value as {status?: string; revision?: number} | undefined);
          },
          () => {
            finish({status: 'unknown'});
          },
        );
      } else if (result) finish(result as {status?: string; revision?: number});
      else {
        step(w => {
          if (w.preview?.controller !== operation.controller) return;
          w.preview = null;
          dismiss(w);
          settle(w);
        });
      }
    };

    // ---- Controls ----

    const toggleClimate = (s: W) => {
      if (s.model.mode === 'observed') {
        const status = s.model.climate.status;
        if (s.input.connected !== false && status !== null) {
          const wanted = status === 'off' ? 'climateOn' : 'climateOff';
          if (offered(s, wanted)) void get().beginVehicle(wanted, 'climateToggle');
        }
        return;
      }
      if (!controlsEnabled(s)) return;
      get().requestConfirmation({action: 'climate', value: s.model.climate.status === 'off'}, 'climateToggle');
    };

    const adjust = (s: W, delta: number, control: 'temperatureDown' | 'temperatureUp') => {
      const model = s.model;
      if (model.mode === 'observed' && offered(s, 'temperature')) {
        const c = model.climate;
        const target = c.targetTemperatureC;
        const value = finite(target) ? target + delta * 0.5 : NaN;
        if (
          c.temperatureStepC === 0.5 &&
          finite(c.minTemperatureC) &&
          finite(c.maxTemperatureC) &&
          finite(target) &&
          value >= c.minTemperatureC &&
          value <= c.maxTemperatureC
        ) {
          void get().beginVehicle('temperature', control, {temperature: value});
        }
        return;
      }
      if (settingsEnabled(s)) {
        const temperatureC = Math.max(16, Math.min(30, (model.climate.targetTemperatureC ?? NaN) + delta));
        step(w => {
          if (w.draft) w.draft.temperatureC = temperatureC;
        });
        sendPreview(
          {
            action: 'climate-settings',
            temperatureC,
            seats: {...(model.climate.seats ?? NO_SEATS)},
            confirmed: true,
            revision: model.revision,
          },
          control,
        );
      }
    };

    const toggleTrunk = (s: W) => {
      if (s.model.mode === 'observed') {
        const state = s.model.access?.rearTrunk;
        if (state !== 'open' && state !== 'closed') return;
        void get().beginVehicle('rearTrunkToggle', 'rearTrunkButton', {direction: state === 'closed' ? 'open' : 'close'});
        return;
      }
      get().requestConfirmation(
        {action: 'rear-trunk', value: s.model.access?.rearTrunk === 'open' ? 'closed' : 'open'},
        'rearTrunkButton',
      );
    };

    const toggleDefrost = (s: W) => {
      if (defrostDisabled(s)) return;
      const model = s.model;
      if (model.mode === 'observed' && typeof model.climate.defrost === 'boolean') {
        void get().beginVehicle(model.climate.defrost ? 'defrostOff' : 'defrostOn', 'defrostButton');
        return;
      }
      if (settingsEnabled(s)) {
        get().requestConfirmation({action: 'defrost', value: !model.climate.defrost}, 'defrostButton');
      }
    };

    const confirm = (s: W) => {
      if (s.proposal) {
        const {proposal, trigger} = s.proposal;
        step(w => {
          w.proposal = null;
          dismiss(w);
        });
        void get().finishVehicle(proposal, trigger);
        return;
      }
      const pending = s.confirm;
      if (!controlsEnabled(s) || !pending || pending.revision !== s.model.revision) return;
      const event: PreviewEvent = {...pending.intent, confirmed: true, revision: pending.revision};
      delete event.setting;
      step(w => {
        dismiss(w, {restoreFocus: false, resetDraft: false});
      });
      sendPreview(event, pending.trigger);
    };

    const initial = (): VehicleState => ({
      input: DEFAULT_INPUT,
      model: unconnectedVehicleModel(),
      configuredUnavailable: false,
      draft: undefined,
      draftRevision: undefined,
      unknownRevision: undefined,
      charge: null,
      chargeCue: 0,
      artwork: false,
      imageState: undefined,
      notes: {access: emptyNote(), climate: emptyNote()},
      feedbackNotes: {access: false, climate: false},
      commands: {},
      feedback: [],
      busy: false,
      setupTrigger: null,
      proposal: null,
      confirm: null,
      dialogOpen: false,
      dialog: null,
      preview: null,
      commandResult: null,
      commandTarget: null,
      commandNote: 'access',
      seatExpanded: false,
      focus: null,
      disposed: false,
    });

    return {
      ...initial(),

      render: (value, options = {}) => step(w => renderModel(w, value, options)),
      refresh: () => {
        step(settle);
      },

      control: control => {
        const s = get();
        if (s.disposed) return;
        switch (control) {
          case 'climateToggle':
            toggleClimate(s);
            return;
          case 'temperatureDown':
            adjust(s, -1, control);
            return;
          case 'temperatureUp':
            adjust(s, 1, control);
            return;
          case 'lock':
          case 'unlock':
          case 'climateOn':
          case 'climateOff':
            void get().beginVehicle(control, control);
            return;
          case 'lockButton':
            if (!controlsEnabled(s)) return;
            if (s.model.locked) get().requestConfirmation({action: 'lock', value: false}, 'lockButton');
            else sendPreview({action: 'lock', value: true, revision: s.model.revision}, 'lockButton');
            return;
          case 'rearTrunkButton':
            toggleTrunk(s);
            return;
          case 'defrostButton':
            toggleDefrost(s);
            return;
          case 'lockCancel':
            step(w => {
              dismiss(w);
            });
            return;
          case 'lockConfirm':
            confirm(s);
            return;
          default:
            return;
        }
      },

      seatChange: (seat, level) => {
        const s = get();
        const model = s.model;
        if (s.disposed) return;
        if (model.mode === 'observed') {
          const action = seat === 'driver' ? 'driverSeatHeat' : 'passengerSeatHeat';
          const option = SEAT_LEVELS[level];
          if (option) void get().beginVehicle(action, seatControl(seat, level), {option});
          return;
        }
        if (!settingsEnabled(s)) return;
        step(w => {
          if (w.draft) w.draft.seats[seat] = level;
        });
        const seats = {...(model.climate.seats ?? NO_SEATS), [seat]: level};
        sendPreview(
          {
            action: 'climate-settings',
            temperatureC: model.climate.targetTemperatureC,
            seats,
            confirmed: true,
            revision: model.revision,
          },
          seatControl(seat, level),
        );
      },

      toggleSeats: () => {
        step(w => {
          if (seatsDisabled(w)) return;
          w.seatExpanded = !w.seatExpanded;
          settle(w);
        });
      },

      beginVehicle: async (action, trigger, args = {}) => {
        const s = get();
        if (actionBlocked(s, action) || s.proposal) return;
        if (climateDependents.has(action) && !liveClimateActive(s.model)) return;
        const historical = s.model.historicalFields ?? [];
        if (
          (!idempotentActions.has(action) && (ACTION_FIELDS[action] ?? []).some(f => historical.includes(f))) ||
          !offered(s, action) ||
          s.model.mode !== 'observed' ||
          s.input.connected === false ||
          s.disposed
        ) {
          return;
        }
        step(w => {
          w.busy = true;
          w.setupTrigger = trigger;
        });
        const started = life;
        const presented = () => !get().disposed && life === started;
        let proposal: VehicleProposal | null | undefined;
        try {
          proposal = await onVehicleSetup(action, args, presented);
        } catch {
          // A failed setup is no proposal.
        }
        const ready = step(w => {
          w.setupTrigger = null;
          w.busy = false;
          if (!proposal || w.disposed) {
            onVehicleCancel(proposal?.operation);
            if (!w.disposed) {
              const key: NoteKey = CLIMATE_ACTIONS.includes(action) ? 'climate' : 'access';
              const note = w.notes[key];
              if (note.state !== 'unknown' || !note.text) {
                w.notes[key] = {state: 'error', text: 'Betjeningen kunne ikke hentes.'};
              }
            }
            return null;
          }
          const c = proposal.confirmation;
          if (!c.requiresConfirmation && !c.nativeWakePossible && !c.requiresOverride) return proposal;
          propose(w, proposal, trigger);
          return null;
        });
        if (ready) await get().finishVehicle(ready, trigger);
      },

      finishVehicle: async (proposal, trigger) => {
        const s = get();
        const {action} = proposal.confirmation;
        const args = proposal.confirmation.args ?? {};
        if (actionBlocked(s, action) || s.disposed || s.input.connected === false) return;
        const family = actionFamily(action);
        const effect = LIVE_EFFECTS[action];
        const field = effect?.field;
        const model = s.model;
        const command: LiveCommand = {
          id: ++commandIds,
          family,
          operation: proposal.operation,
          trigger,
          action,
          args,
          field,
          expected: effect?.wanted(args),
          label: text(effect?.label, args) ?? '',
          confirmation: text(effect?.confirmation, args) ?? '',
          previousAt: (field ? model.fieldObservedAt?.[field] : undefined) ?? model.observedAt ?? 0,
          sentAt: Date.now() / 1000,
          phase: 'sending',
          note: actionNote(action),
          // HA did not know the field when sent (e.g. unknown after a Core restart): Tesla wakes the car.
          awaitingCar:
            !!field &&
            (historicalField(model, field, s.input.connected) ||
              fieldValue(model, field) == null ||
              ['asleep', 'offline'].includes(model.connectionState ?? '')),
          contradicted: false,
        };
        // A sleeping, offline or unknown car is woken by the command before it can answer. One short line under
        // the title; the switch itself shows the progress (fejl 11, 13 Nov).
        if (command.awaitingCar) command.label = 'Vækker bilen…';
        step(w => {
          w.commands[family] = command;
          w.feedback = w.feedback.filter(row => row.command.family !== family);
          w.notes[command.note] = {...w.notes[command.note], text: ''};
          w.busy = true;
          settle(w);
        });
        let result: VehicleSendResult | undefined;
        try {
          result = await onVehicleSend(proposal.operation);
        } catch {
          result = {status: 'unknown'};
        }
        step(w => {
          w.busy = false;
          if (w.disposed) return;
          if (!current(w, command)) {
            settle(w);
            return;
          }
          const live = w.commands[family] ?? command;
          if (result?.error && !result.late) {
            finishFeedback(w, live, 'error', ERROR_TEXTS[result.error] ?? ERROR_TEXTS.refused ?? '');
          } else if (result?.late) {
            if (live.operation.presentationCurrent?.()) finishFeedback(w, live, 'unknown', UNKNOWN_OUTCOME);
            else clearCommand(w, live);
          } else if (result?.status === 'accepted') {
            const observing = {...live, phase: 'observing' as const};
            w.commands[family] = observing;
            reconcileCommand(w, observing);
            if (current(w, observing)) {
              observationWaits.set(
                observing.id,
                observing.operation.waitForObservation?.(() => {
                  step(v => {
                    const now = v.commands[family];
                    if (now?.id !== observing.id || now.phase !== 'observing') return;
                    const notDone = contradiction(v, now);
                    if (notDone) {
                      finishFeedback(v, {...now, contradicted: true}, 'error', notDone);
                    } else finishFeedback(v, now, 'unknown', UNKNOWN_OUTCOME);
                    settle(v);
                  });
                }),
              );
            }
          } else if (result?.status === 'unknown') {
            finishFeedback(w, live, 'unknown', UNKNOWN_OUTCOME);
            const kept = w.commands[family];
            if (kept) reconcileCommand(w, kept);
          } else if (result?.status === 'example') {
            finishFeedback(w, live, 'ready', 'Lokalt eksempel · ingen bil betjenes.');
          } else {
            finishFeedback(w, live, 'error', 'Handlingen blev afvist.');
          }
          settle(w);
        });
      },

      requestConfirmation: (intent, trigger) => {
        step(w => {
          requestConfirmation(w, intent, trigger);
        });
      },

      dismissConfirmation: options => {
        step(w => {
          dismiss(w, options);
        });
      },

      dialogClosed: () => {
        step(w => {
          if (!w.dialogOpen) return;
          dismiss(w);
          settle(w);
        });
      },

      sendAction: (event, trigger) => {
        sendPreview(event, trigger);
      },

      imageLoaded: () => {
        step(w => {
          if (w.disposed || !w.artwork) return;
          w.imageState = 'ready';
        });
      },
      imageFailed: () => {
        step(w => {
          if (!w.disposed) w.imageState = 'missing';
        });
      },

      leave: () => {
        step(w => {
          dismiss(w, {restoreFocus: false});
          w.charge = null;
        });
        cancelAnimation();
      },

      dispose: () => {
        step(w => {
          w.notes = {access: {...w.notes.access, text: ''}, climate: {...w.notes.climate, text: ''}};
          w.disposed = true;
          for (const command of Object.values(w.commands)) clearCommand(w, command);
          w.preview?.controller.abort();
          w.preview = null;
          dismiss(w);
          w.charge = null;
        });
        cancelAnimation();
      },

      reset: () => {
        life++;
        for (const cancel of observationWaits.values()) cancel?.();
        observationWaits.clear();
        cancelAnimation();
        set(initial());
        step(w => renderModel(w, undefined, {}));
      },

      setChargeAnimation: next => {
        animation = next ?? null;
      },
      chargeAnimation: () => animation,
      liveCommand: family => get().commands[family],

      hasDraft: () => {
        const {model: m, draft} = get();
        if (!draft) return true;
        return (
          draft.temperatureC !== m.climate.targetTemperatureC ||
          SEATS.some(seat => draft.seats[seat] !== m.climate.seats?.[seat])
        );
      },
    };
  });
  // As the screen first appears: no car yet.
  store.getState().render();
  return store;
}

export const seatLevel = (state: VehicleState, seat: Seat): number => {
  const m = state.model;
  if (liveEnabled(state)) {
    const current = SEAT_LEVELS.indexOf(seatHeat(m, seat) ?? '');
    if (current >= 0) return current;
  }
  return m.climate.seats?.[seat] ?? 0;
};
