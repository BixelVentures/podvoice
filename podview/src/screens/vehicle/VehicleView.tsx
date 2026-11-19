// Bil: the controller the pre-React shell (widget-view.js) drives for the vehicle screen (#vehicle-view). Same public
// API as the old vehicle-view.js: render(value, options) projects an observed car, a local fixture or nothing; the
// named parts (hero, status, climate.detail, lockButton, ...) stay the same elements for the shell and tests; the
// live command flow (beginVehicle → confirmation → finishVehicle → observation) and the local preview flow
// (sendAction) keep their rules. Controls are explicit: a local fixture never reaches a car, and an observation
// never grants a command. The controller keeps what each element shows (screen.ts) and React renders it
// (VehicleDetail.tsx), synchronously (flushSync), so the page is current when a call returns, as before. Native
// element state stays native: the dialog's showModal/close, focus, scroll position and the seat radios' checked.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {applyKitTemplate} from '../../../ui/kit.js';
import {vehicleChargeUpdate, vehicleModel, vehicleUpdatedLabel, VEHICLE_ARTWORK} from '../../../vehicle-model.js';
import type {VehicleChargeContext, VehicleChargePresentation, VehicleModel} from '../../../vehicle-model.js';
import {assign, buttonContent, faceText, initialScreen, kit, powerToggle, removeAttr, setAttr} from './screen';
import type {Face, GroupFaces, LiveAction, Seat, VehicleScreen} from './screen';
import {VehicleDetail} from './VehicleDetail';
import type {TimelineData, VehicleControl} from './VehicleDetail';

type Args = Record<string, unknown>;

export interface VehicleConfirmation {
  action: string;
  label?: string;
  args?: Args;
  effects?: [string, string][];
  requiresConfirmation?: boolean;
  nativeWakePossible?: boolean;
  requiresOverride?: boolean;
  priorUnresolved?: Record<string, string[]> & {access: string[]; climate: string[]};
  riskRevision?: number;
}

export interface VehicleOperation {
  exampleOnly?: boolean;
  presentationCurrent?: () => boolean;
  observationCurrent?: () => boolean;
  waitForObservation?: (callback: () => void) => (() => void) | null | undefined;
}

export interface VehicleProposal {
  confirmation: VehicleConfirmation;
  operation: VehicleOperation;
}

export interface VehicleSendResult {
  status?: string;
  error?: string;
  late?: boolean;
}

export interface PreviewResult {
  status?: string;
  revision?: number;
}

export interface PreviewEvent {
  action: string;
  value?: unknown;
  confirmed?: boolean;
  revision?: number | undefined;
  temperatureC?: number | null | undefined;
  seats?: {driver: number; passenger: number} | undefined;
  setting?: string;
}

interface PreviewOptions {
  signal: AbortSignal;
  onProgress: (progress?: {phase?: string}) => void;
}
// What a preview callback returns: a result, a promise of one, or nothing (a legacy synchronous callback).
type PreviewOutcome = unknown;

export interface VehicleViewOptions {
  onAction?: (event: PreviewEvent, options: PreviewOptions) => PreviewOutcome;
  onVehicleSetup?: (action: string, args: Args) => Promise<VehicleProposal | null | undefined> | VehicleProposal | null;
  onVehicleSend?: (operation: VehicleOperation) => Promise<VehicleSendResult | undefined> | VehicleSendResult;
  onVehicleCancel?: (operation?: VehicleOperation) => void;
}

export interface VehicleRenderOptions {
  connected?: boolean;
  connectionDetail?: string | null;
  chargeContext?: VehicleChargeContext | undefined;
  vehicleActions?: unknown;
  feedbackScope?: string | null;
}

interface Snapshot {
  bootId?: unknown;
  roomId?: unknown;
  sessionId?: unknown;
  providerGeneration?: unknown;
}

type Family = 'trunk' | 'lock' | 'climate';
type Phase = 'sending' | 'observing' | 'unknown';
type NoteState = 'ready' | 'unknown' | 'error';

interface LiveCommand {
  family: Family;
  operation: VehicleOperation;
  trigger: Element | null;
  action: string;
  args: Args;
  field: string | undefined;
  expected: unknown;
  read: ((model: VehicleModel) => unknown) | undefined;
  label: string;
  confirmation: string;
  previousAt: number;
  sentAt: number;
  phase: Phase;
  note: HTMLElement;
  awaitingCar?: boolean;
  cancelObservation?: (() => void) | null | undefined;
  contradicted?: boolean;
}

interface LiveFeedback {
  command: LiveCommand;
  state: NoteState;
  text: string;
}

interface PendingPreview {
  trigger: Element | null | undefined;
  label: string;
  intentValue: unknown;
  revision: number | undefined;
  controller: AbortController;
  phase?: 'waking' | 'awaiting';
}

interface Draft {
  temperatureC: number | null | undefined;
  seats: {driver?: number; passenger?: number};
}

interface DisclosureParts {
  node: HTMLElement;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  setExpanded: (value: boolean) => void;
  setDescription: (value: string) => void;
  setDisabled: (value: boolean) => void;
}

interface ChoiceGroupParts {
  node: HTMLFieldSetElement;
  inputs: HTMLInputElement[];
  setValue: (value: number | string) => void;
  setDisabled: (value: boolean) => void;
  setChoiceDisabled: (choice: number | string, disabled: boolean) => void;
}

interface GroupParts {
  detail: HTMLElement;
  status: HTMLElement;
  body: HTMLElement;
  values: {id: string; value: HTMLElement}[];
}

interface ChargeMotion {
  animate: (node: Element, frames: Keyframe[], duration: number) => Animation | null | undefined;
}

interface WidgetHost extends Element {
  dispatch?: (event: {type: string; id: string}) => void;
  focusHeading?: () => void;
  motion?: ChargeMotion;
}

const ignore = () => undefined;
const historicalField = (model: VehicleModel, field: string, connected: boolean | undefined) =>
  model.stale === true || connected === false || (model.historicalFields ?? []).includes(field);

const vehicleFieldValue = (model: VehicleModel, field: string): unknown => {
  if (field === 'trunk') return model.access?.rearTrunk;
  let value: unknown = model;
  for (const key of field.split('.')) {
    value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  }
  return value;
};
// Lock and climate on/off are idempotent: an older or unknown HA value never blocks them.
const idempotentVehicleActions = new Set(['lock', 'unlock', 'climateOn', 'climateOff']);
const climateDependents = new Set(['temperature', 'defrostOn', 'defrostOff', 'driverSeatHeat', 'passengerSeatHeat']);
const unlockTitle = 'Lås bilen op?';
const unlockConsequence = 'Bilen låses op. Den låses ikke automatisk igen herfra.';
const activeClimateModes = new Set(['heat', 'cool', 'auto', 'heat_cool', 'fan_only', 'dry']);
const liveClimateActive = (model: VehicleModel | undefined) =>
  !!model &&
  !model.stale &&
  !(model.historicalFields ?? []).includes('climate.status') &&
  activeClimateModes.has(model.climate.status ?? '');

const vehicleActionFamily = (action: string): Family =>
  action === 'rearTrunkToggle' ? 'trunk' : action === 'lock' || action === 'unlock' ? 'lock' : 'climate';
// HA's clock (last_changed) and the screen's clock can differ by a few seconds.
// The field must still be newer than what was shown before the tap.
const CLOCK_SKEW_S = 30;
type Text = string | ((args: Args) => string);
type Effect = [string, (args: Args) => unknown, (model: VehicleModel) => unknown, Text, Text];
const direction = (args: Args) => args.direction === 'open';
const liveVehicleEffects: Record<string, Effect> = {
  lock: ['locked', () => true, model => model.locked, 'Låser…', 'Bilen er låst.'],
  unlock: ['locked', () => false, model => model.locked, 'Låser op…', 'Bilen er låst op.'],
  rearTrunkToggle: [
    'trunk',
    args => (direction(args) ? 'open' : 'closed'),
    model => model.access?.rearTrunk,
    args => (direction(args) ? 'Åbner bagagerum…' : 'Lukker bagagerum…'),
    args => (direction(args) ? 'Bagagerummet er åbent.' : 'Bagagerummet er lukket.'),
  ],
  climateOn: [
    'climate.status',
    () => true,
    model => activeClimateModes.has(model.climate.status ?? '') || undefined,
    'Tænder…',
    'Klimaet er tændt.',
  ],
  climateOff: [
    'climate.status',
    () => true,
    model => model.climate.status === 'off' || undefined,
    'Slukker…',
    'Klimaet er slukket.',
  ],
  temperature: [
    'climate.targetTemperatureC',
    args => args.temperature,
    model => model.climate.targetTemperatureC,
    'Ændrer temperatur…',
    args => `Måltemperaturen er ${(args.temperature as number | undefined)?.toLocaleString('da-DK') ?? ''} °C.`,
  ],
  defrostOn: ['climate.defrost', () => true, model => model.climate.defrost, 'Afrimer…', 'Afrimningen er tændt.'],
  defrostOff: [
    'climate.defrost',
    () => false,
    model => model.climate.defrost,
    'Stopper afrimning…',
    'Afrimningen er slukket.',
  ],
  driverSeatHeat: [
    'climate.driverSeatHeat',
    args => args.option,
    model => model.climate.driverSeatHeat,
    'Ændrer sædevarme…',
    'Førerens sædevarme er opdateret.',
  ],
  passengerSeatHeat: [
    'climate.passengerSeatHeat',
    args => args.option,
    model => model.climate.passengerSeatHeat,
    'Ændrer sædevarme…',
    'Passagerens sædevarme er opdateret.',
  ],
};
// HA's explicit service error (closed code from the server) in short Danish.
const vehicleErrorTexts: Record<string, string> = {
  access_denied: 'Home Assistant afviste adgangen til bilen.',
  missing_scope: 'Tesla-forbindelsen mangler tilladelse til kommandoer.',
  wake_failed: 'Bilen kunne ikke vækkes.',
  no_response: 'Bilen svarede ikke.',
  rate_limited: 'Tesla afviser flere kommandoer lige nu · prøv igen senere.',
  refused: 'Bilen afviste kommandoen.',
};
// A fresh observation after the command that contradicts it: what the car did not do.
const vehicleNotDone: Record<string, Text> = {
  lock: 'Bilen låste ikke',
  unlock: 'Bilen låste ikke op',
  rearTrunkToggle: args => (direction(args) ? 'Bagagerummet åbnede ikke' : 'Bagagerummet lukkede ikke'),
  climateOn: 'Bilen tændte ikke klimaet',
  climateOff: 'Bilen slukkede ikke klimaet',
  temperature: 'Bilen ændrede ikke temperaturen',
  defrostOn: 'Bilen tændte ikke afrimningen',
  defrostOff: 'Bilen slukkede ikke afrimningen',
  driverSeatHeat: 'Bilen ændrede ikke sædevarmen',
  passengerSeatHeat: 'Bilen ændrede ikke sædevarmen',
};
const text = (value: Text | undefined, args: Args) => (typeof value === 'function' ? value(args) : value);
// Tesla may refuse remote climate at low battery; HA reports no error then.
const LOW_BATTERY_PERCENT = 15;
const lowBattery = (model: VehicleModel | undefined) =>
  model?.mode === 'observed' &&
  typeof model.batteryPercent === 'number' &&
  Number.isFinite(model.batteryPercent) &&
  model.batteryPercent < LOW_BATTERY_PERCENT
    ? Math.round(model.batteryPercent)
    : null;
const isThenable = (value: unknown): value is PromiseLike<PreviewResult | undefined> =>
  typeof (value as {then?: unknown} | null | undefined)?.then === 'function';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const da = (value: number) => value.toLocaleString('da-DK');
const LEVELS = ['Fra', 'Lav', 'Mellem', 'Høj'];
const SEAT_LEVELS = ['off', 'low', 'medium', 'high'];
const SEAT_NAMES: Record<string, string> = {off: 'Fra', low: 'Lav', medium: 'Mellem', high: 'Høj'};
const CLIMATE_ACTIONS = ['climateOn', 'climateOff', 'temperature', 'defrostOn', 'defrostOff', 'driverSeatHeat',
  'passengerSeatHeat'];
const TEMPERATURE_FIELDS = ['climate.status', 'climate.targetTemperatureC', 'climate.minTemperatureC',
  'climate.maxTemperatureC', 'climate.temperatureStepC'];
const ACTION_FIELDS: Record<string, string[]> = {
  lock: ['locked'],
  unlock: ['locked'],
  rearTrunkToggle: ['trunk'],
  climateOn: ['climate.status'],
  climateOff: ['climate.status'],
  temperature: TEMPERATURE_FIELDS,
  defrostOn: ['climate.defrost'],
  defrostOff: ['climate.defrost'],
  driverSeatHeat: ['climate.driverSeatHeat'],
  passengerSeatHeat: ['climate.passengerSeatHeat'],
};
const CLIMATE_NAMES: Record<string, string> = {
  off: 'Slukket',
  heat: 'Varmer',
  cool: 'Køler',
  auto: 'Automatisk',
  heat_cool: 'Varme/køling',
  fan_only: 'Ventilation',
  dry: 'Affugtning',
};
const PRIOR_NAMES: Record<string, string> = {
  temperature: 'ændre temperaturen',
  defrost: 'betjene afrimningen',
  driverSeat: 'ændre førersædevarmen',
  passengerSeat: 'ændre passagersædevarmen',
  trunk: 'betjene bagagerummet',
};
const SEATS: readonly Seat[] = ['driver', 'passenger'];
const LIVE_ACTIONS: readonly LiveAction[] = ['lock', 'unlock', 'climateOn', 'climateOff'];
const seatHeat = (model: VehicleModel, seat: Seat) =>
  seat === 'driver' ? model.climate.driverSeatHeat : model.climate.passengerSeatHeat;

function part<T extends Element>(node: ParentNode, selector: string, type: abstract new () => T): T {
  const found = node.querySelector(selector);
  if (!(found instanceof type)) throw Error(`Vehicle screen is missing ${selector}`);
  return found;
}

// One retained detail composition: observed car, access, combined climate and
// charging facts in the Hero. Controls are explicit local previews; observations grant none.
export class VehicleView {
  root: HTMLElement;
  onAction: NonNullable<VehicleViewOptions['onAction']>;
  onVehicleSetup: NonNullable<VehicleViewOptions['onVehicleSetup']>;
  onVehicleSend: NonNullable<VehicleViewOptions['onVehicleSend']>;
  onVehicleCancel: NonNullable<VehicleViewOptions['onVehicleCancel']>;
  liveVehicleCommands = new Map<Family, LiveCommand>();
  liveVehicleFeedback = new Map<Family, LiveFeedback>();
  liveVehicleFeedbackNotes = new Set<HTMLElement>();
  model!: VehicleModel;
  connected: boolean | undefined = true;
  vehicleActions: string[] = [];
  feedbackScope: string | null | undefined;
  draft: Draft | undefined;
  draftRevision: number | undefined;
  unknownRevision: number | null | undefined;
  controlsEnabled = false;
  settingsEnabled = false;
  pending: PendingPreview | null = null;
  commandResult: 'confirmed' | 'failed' | 'unknown' | null = null;
  commandTarget: Element | null | undefined;
  confirmAction: PreviewEvent | null = null;
  confirmTrigger: HTMLElement | null = null;
  confirmRevision: number | null | undefined = null;
  vehicleProposal: VehicleProposal | null = null;
  vehicleTrigger: Element | null = null;
  vehiclePending = false;
  chargePresentation: VehicleChargePresentation | null = null;
  chargeAnimation: Animation | null = null;
  seatScrollTop: number | undefined;
  disposed = false;
  // Named parts, found once after the first render.
  heading!: HTMLElement;
  title!: HTMLElement;
  hero!: HTMLElement;
  heroIcon!: HTMLImageElement;
  status!: HTMLElement;
  connectionNote!: HTMLElement;
  content!: HTMLElement;
  figure!: HTMLElement;
  image!: HTMLImageElement;
  context!: HTMLElement;
  measurements!: HTMLElement;
  metrics!: HTMLElement;
  batteryGroup!: HTMLElement;
  batteryValue!: HTMLElement;
  rangeGroup!: HTMLElement;
  rangeValue!: HTMLElement;
  cabinValue!: HTMLElement;
  powerGroup!: HTMLElement;
  powerValue!: HTMLElement;
  finishGroup!: HTMLElement;
  finishValue!: HTMLElement;
  rail!: HTMLElement;
  meter!: HTMLMeterElement;
  dots!: HTMLElement;
  secondary!: HTMLElement;
  controlTiles!: HTMLElement;
  climate!: GroupParts;
  access!: GroupParts;
  health!: GroupParts;
  more!: GroupParts;
  capabilities!: GroupParts[];
  climateBatteryNote!: HTMLElement;
  climateToggle!: HTMLButtonElement;
  temperatureControls!: HTMLElement;
  temperatureValue!: HTMLOutputElement;
  temperatureDown!: HTMLButtonElement;
  temperatureUp!: HTMLButtonElement;
  liveVehicleButtons!: Record<LiveAction, HTMLButtonElement>;
  lockControls!: HTMLElement;
  lockButton!: HTMLButtonElement;
  rearTrunkButton!: HTMLButtonElement;
  climateActions!: HTMLElement;
  defrostButton!: HTMLButtonElement;
  seatControls!: DisclosureParts;
  seatGroups!: Record<Seat, ChoiceGroupParts>;
  accessFeedback!: HTMLElement;
  climateFeedback!: HTMLElement;
  commandNote!: HTMLElement;
  history!: HTMLElement;
  historyTitle!: HTMLElement;
  timeline!: HTMLElement;
  empty!: HTMLElement;
  confirmation!: HTMLDialogElement;
  confirmTitle!: HTMLElement;
  confirmationNote!: HTMLElement;
  lockConfirm!: HTMLButtonElement;
  lockCancel!: HTMLButtonElement;
  // The overview action is kept for the shell's contract; the global back action owns it, so it is never shown.
  next: HTMLButtonElement;
  // What each element shows; React draws it on every paint.
  private ui: VehicleScreen = initialScreen();
  private timelineData: TimelineData | null = null;
  private faces = new Map<Element, Face>();
  private reactRoot: Root | undefined;
  private depth = 0;
  private seatExpanded = false;
  private seatDisabled = false;
  private seatSelected: Record<Seat, string | number> = {driver: 0, passenger: 0};
  private seatBlocked: Record<Seat, boolean> = {driver: false, passenger: false};
  private readonly nativeListeners: [EventTarget, string, EventListener][] = [];

  constructor(root: HTMLElement, options: VehicleViewOptions = {}) {
    this.root = root;
    this.onAction = options.onAction ?? ignore;
    this.onVehicleSetup = options.onVehicleSetup ?? (async () => Promise.resolve(null));
    this.onVehicleSend = options.onVehicleSend ?? (async () => Promise.resolve({status: 'failed'}));
    this.onVehicleCancel = options.onVehicleCancel ?? ignore;
    applyKitTemplate(root, 'detail');
    this.next = root.ownerDocument.createElement('button');
    this.next.className = 'text-control pv-button pv-kit pv-kit-button pv-btn';
    this.next.textContent = 'Til overblikket';
    for (const [name, value] of [['data-kit', 'button'], ['data-kit-identity', 'neutral'],
      ['data-kit-variant', 'secondary']] as const) this.next.setAttribute(name, value);
    this.next.type = 'button';
    this.next.hidden = true;
    root.replaceChildren();
    root.classList.add('vehicle-view');
    this.reactRoot = createRoot(root);
    this.paint();
    this.name();
    this.listen();
    this.render();
  }

  // ---- React ---------------------------------------------------------------------------------------------------

  private readonly onControl = (control: VehicleControl) => {
    this.run(() => {
      this.control(control);
    });
  };

  // The shared leaf motion acknowledges a fresh charging reading once, after the meter shows it.
  private readonly onChargeCue = (meter: HTMLMeterElement) => {
    const host = this.root.closest<WidgetHost>('pv-widget-host');
    this.chargeAnimation = host?.motion?.animate(meter, [{opacity: 0.65}, {opacity: 1}], 120) ?? null;
  };

  // Runs one step and draws its result once at the end, however many steps it nests.
  private run<T>(step: () => T): T {
    this.depth++;
    try {
      return step();
    } finally {
      this.depth--;
      if (this.depth === 0) this.paint();
    }
  }

  private paint() {
    const reactRoot = this.reactRoot;
    if (!reactRoot || this.depth > 0) return;
    const screen = structuredClone(this.ui);
    flushSync(() => {
      reactRoot.render(
        <VehicleDetail
          screen={screen}
          timeline={this.timelineData}
          onControl={this.onControl}
          onChargeCue={this.onChargeCue}
        />,
      );
    });
  }

  // Removes the screen; the shell calls it when it drops this view.
  unmount() {
    const reactRoot = this.reactRoot;
    this.reactRoot = undefined;
    reactRoot?.unmount();
  }

  private name() {
    const root = this.root;
    const ui = this.ui;
    const at = (selector: string) => part(root, selector, HTMLElement);
    this.heading = at(':scope > header');
    this.title = part(this.heading, 'h1', HTMLElement);
    this.hero = at(':scope > .vehicle-hero');
    this.status = part(this.hero, ':scope > .vehicle-status', HTMLElement);
    this.connectionNote = part(this.hero, ':scope > .vehicle-connection-note', HTMLElement);
    this.content = part(this.hero, ':scope > .vehicle-content', HTMLElement);
    this.heroIcon = part(this.hero, ':scope > [data-kit-slot="icon"]', HTMLImageElement);
    this.dots = part(this.hero, ':scope > .vehicle-dots', HTMLElement);
    this.figure = part(this.content, '.vehicle-artwork', HTMLElement);
    this.image = part(this.figure, '.vehicle-image', HTMLImageElement);
    this.context = part(this.figure, '.vehicle-context', HTMLElement);
    this.measurements = part(this.content, '.vehicle-measurements', HTMLElement);
    this.metrics = part(this.measurements, '.vehicle-metrics', HTMLElement);
    const [battery, range, power, finish] = [...this.metrics.children] as HTMLElement[];
    if (!battery || !range || !power || !finish) throw Error('Vehicle screen is missing a metric');
    this.batteryGroup = battery;
    this.batteryValue = part(battery, 'dd', HTMLElement);
    this.rangeGroup = range;
    this.rangeValue = part(range, '.vehicle-range-value', HTMLElement);
    this.cabinValue = part(range, '.vehicle-cabin-value', HTMLElement);
    this.powerGroup = power;
    this.powerValue = part(power, 'dd', HTMLElement);
    this.finishGroup = finish;
    this.finishValue = part(finish, 'dd', HTMLElement);
    this.rail = part(this.measurements, '.vehicle-battery-rail', HTMLElement);
    this.meter = part(this.rail, 'meter', HTMLMeterElement);
    this.secondary = at(':scope > .vehicle-secondary');
    this.controlTiles = part(this.secondary, '.vehicle-control-tiles', HTMLElement);
    const [accessTile, climateTile] = [...this.controlTiles.children] as HTMLElement[];
    const [healthTile, moreTile] = [...this.secondary.querySelectorAll<HTMLElement>(':scope > details')];
    if (!accessTile || !climateTile || !healthTile || !moreTile) throw Error('Vehicle screen is missing a group');
    const group = (detail: HTMLElement, ids: string[], faces: GroupFaces): GroupParts => {
      const status = part(detail, ':scope > :first-child > small', HTMLElement);
      const body = part(detail, ':scope > dl', HTMLElement);
      const values = [...body.querySelectorAll<HTMLElement>(':scope > div > dd')];
      this.faces.set(detail, faces.detail);
      this.faces.set(status, faces.status);
      return {detail, status, body, values: values.map((value, index) => ({id: ids[index] ?? '', value}))};
    };
    this.climate = group(climateTile, ['state', 'temperature', 'defrost', 'seats'], ui.climate);
    this.access = group(accessTile, ['locks', 'luggage', 'windows'], ui.access);
    this.health = group(healthTile, ['tires', 'sentry', 'software'], ui.health);
    this.more = group(moreTile, ['wake', 'signal', 'homelink', 'keyless', 'media'], ui.more);
    this.capabilities = [this.access, this.health, this.more];
    this.climateBatteryNote = part(climateTile, ':scope > .vehicle-climate-note', HTMLElement);
    this.climateToggle = part(climateTile, ':scope > [data-kit="toggle"]', HTMLButtonElement);
    this.temperatureControls = part(climateTile, ':scope > .vehicle-temperature-controls', HTMLElement);
    this.temperatureValue = part(this.temperatureControls, 'output', HTMLOutputElement);
    const [down, up] = [...this.temperatureControls.querySelectorAll('button')];
    if (!down || !up) throw Error('Vehicle screen is missing a temperature button');
    this.temperatureDown = down;
    this.temperatureUp = up;
    this.lockControls = part(accessTile, ':scope > .vehicle-lock-controls', HTMLElement);
    const [lock, unlock, lockButton, rearTrunkButton] = [...this.lockControls.querySelectorAll('button')];
    const [climateOn, climateOff] = [
      ...climateTile.querySelectorAll<HTMLButtonElement>(':scope > button[data-live-vehicle-label]'),
    ];
    if (!lock || !unlock || !lockButton || !rearTrunkButton || !climateOn || !climateOff) {
      throw Error('Vehicle screen is missing an action');
    }
    this.liveVehicleButtons = {lock, unlock, climateOn, climateOff};
    this.lockButton = lockButton;
    this.rearTrunkButton = rearTrunkButton;
    this.climateActions = part(climateTile, ':scope > .vehicle-climate-actions', HTMLElement);
    this.defrostButton = part(this.climateActions, 'button', HTMLButtonElement);
    const disclosure = part(climateTile, ':scope > .pv-kit-disclosure', HTMLElement);
    this.seatControls = {
      node: disclosure,
      trigger: part(disclosure, ':scope > button', HTMLButtonElement),
      panel: part(disclosure, ':scope > [role="region"]', HTMLElement),
      setExpanded: value => {
        this.setSeatExpanded(value);
      },
      setDescription: value => {
        this.setSeatDescription(value);
      },
      setDisabled: value => {
        this.setSeatDisabled(value);
      },
    };
    const fieldsets = [...this.seatControls.panel.querySelectorAll('fieldset')];
    this.seatGroups = {
      driver: this.choiceGroup('driver', fieldsets[0]),
      passenger: this.choiceGroup('passenger', fieldsets[1]),
    };
    this.accessFeedback = part(accessTile, ':scope > h2 > [data-kit-slot="status"]', HTMLElement);
    this.climateFeedback = part(climateTile, ':scope > h2 > [data-kit-slot="status"]', HTMLElement);
    this.commandNote = this.accessFeedback;
    this.history = at(':scope > .vehicle-history');
    this.historyTitle = part(this.history, 'h2', HTMLElement);
    this.timeline = part(this.history, 'pv-activity-timeline', HTMLElement);
    this.empty = part(this.history, '.robot-history-note', HTMLElement);
    this.confirmation = part(root, ':scope > dialog', HTMLDialogElement);
    this.confirmTitle = part(this.confirmation, '#vehicle-confirm-title', HTMLElement);
    this.confirmationNote = part(this.confirmation, '#vehicle-confirm-description', HTMLElement);
    const [cancel, confirm] = [...this.confirmation.querySelectorAll('.pv-dialog-actions > button')];
    if (!(cancel instanceof HTMLButtonElement) || !(confirm instanceof HTMLButtonElement)) {
      throw Error('Vehicle screen is missing a dialog action');
    }
    this.lockCancel = cancel;
    this.lockConfirm = confirm;
    for (const [node, target] of [
      [this.climateToggle, ui.climateToggle],
      [this.temperatureDown, ui.temperatureDown],
      [this.temperatureUp, ui.temperatureUp],
      [lock, ui.live.lock],
      [unlock, ui.live.unlock],
      [climateOn, ui.live.climateOn],
      [climateOff, ui.live.climateOff],
      [lockButton, ui.lockButton],
      [rearTrunkButton, ui.rearTrunkButton],
      [this.defrostButton, ui.defrostButton],
      [this.accessFeedback, ui.accessFeedback],
      [this.climateFeedback, ui.climateFeedback],
      [this.lockConfirm, ui.lockConfirm],
      [this.lockCancel, ui.lockCancel],
    ] as const) {
      this.faces.set(node, target);
    }
  }

  // The native single-choice inputs of one seat (createKitChoiceGroup): checked is the inputs' own state.
  private choiceGroup(seat: Seat, node: HTMLFieldSetElement | undefined): ChoiceGroupParts {
    if (!node) throw Error('Vehicle screen is missing a seat group');
    const inputs = [...node.querySelectorAll('input')];
    const faces = this.ui.seatGroups[seat];
    this.faces.set(node, faces.node);
    inputs.forEach((input, index) => {
      const target = faces.inputs[index];
      if (target) this.faces.set(input, target);
    });
    const setValue = (next: number | string) => {
      this.seatSelected[seat] = next;
      for (const input of inputs) if (input.checked !== (input.value === String(next))) {
        input.checked = input.value === String(next);
      }
    };
    return {
      node,
      inputs,
      setValue,
      setDisabled: value => {
        this.seatBlocked[seat] = value;
        setAttr(faces.node, 'aria-disabled', value);
        for (const target of faces.inputs) setAttr(target, 'aria-disabled', value);
      },
      setChoiceDisabled: (choice, disabled) => {
        const index = inputs.findIndex(input => input.value === String(choice));
        const target = faces.inputs[index];
        if (target) target.disabled = disabled;
      },
    };
  }

  private listen() {
    const on = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      this.nativeListeners.push([target, type, listener]);
    };
    // Load and error arrive from the image itself; a missing image keeps the page anatomy and shows the car icon.
    on(this.image, 'error', () => {
      this.run(() => {
        this.ui.image.hidden = true;
        setAttr(this.ui.figure, 'data-image-state', 'missing');
        this.ui.heroIcon.hidden = false;
      });
    });
    on(this.image, 'load', () => {
      this.run(() => {
        if (this.ui.figure.hidden) return;
        this.ui.image.hidden = false;
        this.ui.heroIcon.hidden = true;
        setAttr(this.ui.figure, 'data-image-state', 'ready');
      });
    });
    on(this.next, 'click', () => {
      const host = this.root.closest<WidgetHost>('pv-widget-host');
      host?.dispatch?.({type: 'show', id: 'now'});
      host?.focusHeading?.();
    });
    on(this.confirmation, 'cancel', () => {
      this.dismissConfirmation();
    });
    on(this.confirmation, 'close', () => {
      if (this.confirmation.open) return;
      this.run(() => {
        if (this.vehicleProposal) {
          this.onVehicleCancel(this.vehicleProposal.operation);
          this.vehicleProposal = null;
        }
        this.dismissConfirmation();
      });
    });
    // The seat choice groups own their change listeners, as the kit's did; they outlive cleanup.
    for (const seat of SEATS) {
      const group = this.seatGroups[seat];
      for (const input of group.inputs) {
        input.addEventListener('change', () => {
          this.run(() => {
            if (this.seatBlocked[seat] || input.disabled) {
              group.setValue(this.seatSelected[seat]);
              return;
            }
            if (input.checked) {
              this.seatSelected[seat] = input.value;
              this.changeSeat(seat, input.value);
            }
          });
        });
      }
    }
    this.seatGroups.driver.setValue(0);
    this.seatGroups.passenger.setValue(0);
  }

  private face(node: Element | null | undefined): Face | undefined {
    return node ? this.faces.get(node) : undefined;
  }

  private note(node: HTMLElement): Face {
    return node === this.climateFeedback ? this.ui.climateFeedback : this.ui.accessFeedback;
  }

  // ---- Seat heat disclosure (createKitDisclosure) ---------------------------------------------------------------

  private setSeatExpanded(value: boolean) {
    this.seatExpanded = value && !this.seatDisabled;
    if (!this.seatExpanded && this.seatControls.panel.contains(this.root.ownerDocument.activeElement)) {
      this.seatControls.trigger.focus();
    }
    setAttr(this.ui.seatControls.trigger, 'aria-expanded', this.seatExpanded);
    this.ui.seatControls.panel.hidden = !this.seatExpanded;
  }

  private setSeatDescription(value: string) {
    const {trigger, description} = this.ui.seatControls;
    description.text = value || '';
    description.hidden = !value;
    setAttr(trigger, 'data-has-summary', !!value);
    setAttr(description, 'aria-hidden', !value);
  }

  private setSeatDisabled(value: boolean) {
    this.seatDisabled = value;
    if (value) this.setSeatExpanded(false);
    this.ui.seatControls.trigger.disabled = value;
    setAttr(this.ui.seatControls.trigger, 'aria-disabled', value);
  }

  private toggleSeats() {
    if (this.seatDisabled) return;
    this.setSeatExpanded(!this.seatExpanded);
    const expanded = this.seatExpanded;
    this.renderControls();
    if (expanded) {
      this.seatScrollTop = this.root.scrollTop;
      this.paintNow();
      this.seatControls.panel.scrollIntoView({block: 'nearest', behavior: 'instant'});
    } else this.root.scrollTop = this.seatScrollTop ?? 0;
  }

  // ---- Controls -------------------------------------------------------------------------------------------------

  private control(control: VehicleControl) {
    if (control === 'seatTrigger') {
      this.toggleSeats();
      return;
    }
    if (this.disposed) return;
    switch (control) {
      case 'climateToggle':
        this.toggleClimate();
        return;
      case 'temperatureDown':
        this.adjust(-1, this.temperatureDown);
        return;
      case 'temperatureUp':
        this.adjust(1, this.temperatureUp);
        return;
      case 'lock':
      case 'unlock':
      case 'climateOn':
      case 'climateOff':
        void this.beginVehicle(control, this.liveVehicleButtons[control]);
        return;
      case 'lockButton':
        if (!this.controlsEnabled) return;
        if (this.model.locked) this.requestConfirmation({action: 'lock', value: false}, this.lockButton);
        else this.sendAction({action: 'lock', value: true, revision: this.model.revision}, this.lockButton);
        return;
      case 'rearTrunkButton':
        this.toggleTrunk();
        return;
      case 'defrostButton':
        this.toggleDefrost();
        return;
      case 'lockCancel':
        this.dismissConfirmation();
        return;
      case 'lockConfirm':
        this.confirm();
        return;
    }
  }

  private toggleClimate() {
    const button = this.climateToggle;
    if (this.model.mode === 'observed') {
      const status = this.model.climate.status;
      if (this.connected !== false && status !== null) {
        const offered = status === 'off' ? 'climateOn' : 'climateOff';
        if (this.vehicleActions.includes(offered)) void this.beginVehicle(offered, button);
      }
      return;
    }
    if (!this.controlsEnabled) return;
    this.requestConfirmation({action: 'climate', value: this.model.climate.status === 'off'}, button);
  }

  private adjust(delta: number, button: HTMLButtonElement) {
    if (this.face(button)?.disabled) return;
    const model = this.model;
    if (model.mode === 'observed' && this.vehicleActions.includes('temperature')) {
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
        void this.beginVehicle('temperature', button, {temperature: value});
      }
      return;
    }
    if (this.settingsEnabled) {
      const temperatureC = Math.max(16, Math.min(30, (model.climate.targetTemperatureC ?? NaN) + delta));
      if (this.draft) this.draft.temperatureC = temperatureC;
      this.sendAction(
        {
          action: 'climate-settings',
          temperatureC,
          seats: {...(model.climate.seats ?? {driver: 0, passenger: 0})},
          confirmed: true,
          revision: model.revision,
        },
        button,
      );
    }
  }

  private toggleTrunk() {
    const button = this.rearTrunkButton;
    if (this.model.mode === 'observed') {
      const state = this.model.access?.rearTrunk;
      if (state !== 'open' && state !== 'closed') return;
      void this.beginVehicle('rearTrunkToggle', button, {direction: state === 'closed' ? 'open' : 'close'});
      return;
    }
    this.requestConfirmation(
      {action: 'rear-trunk', value: this.model.access?.rearTrunk === 'open' ? 'closed' : 'open'},
      button,
    );
  }

  private toggleDefrost() {
    if (this.ui.defrostButton.disabled) return;
    const model = this.model;
    if (model.mode === 'observed' && typeof model.climate.defrost === 'boolean') {
      void this.beginVehicle(model.climate.defrost ? 'defrostOff' : 'defrostOn', this.defrostButton);
      return;
    }
    if (this.settingsEnabled) {
      this.requestConfirmation({action: 'defrost', value: !model.climate.defrost}, this.defrostButton);
    }
  }

  private changeSeat(seat: Seat, value: string) {
    const group = this.seatGroups[seat];
    const model = this.model;
    if (model.mode === 'observed' && !this.disposed) {
      const action = seat === 'driver' ? 'driverSeatHeat' : 'passengerSeatHeat';
      const option = SEAT_LEVELS[Number(value)];
      group.setValue(SEAT_LEVELS.indexOf(seatHeat(model, seat) ?? ''));
      if (option) {
        const input = group.inputs.find(item => item.value === value);
        void this.beginVehicle(action, input ?? group.node, {option});
      }
      return;
    }
    if (!this.settingsEnabled || this.disposed) {
      group.setValue(model.climate.seats?.[seat] ?? 0);
      return;
    }
    if (this.draft) this.draft.seats[seat] = Number(value);
    const seats = {...(model.climate.seats ?? {driver: 0, passenger: 0}), [seat]: Number(value)};
    this.sendAction(
      {
        action: 'climate-settings',
        temperatureC: model.climate.targetTemperatureC,
        seats,
        confirmed: true,
        revision: model.revision,
      },
      group.inputs.find(input => input.value === value),
    );
  }

  private confirm() {
    if (this.vehicleProposal) {
      const proposal = this.vehicleProposal;
      const trigger = this.vehicleTrigger;
      this.vehicleProposal = null;
      this.confirmation.close();
      void this.finishVehicle(proposal, trigger);
      return;
    }
    if (!this.controlsEnabled || this.confirmRevision !== this.model.revision || !this.confirmAction) return;
    const event: PreviewEvent = {...this.confirmAction, confirmed: true, revision: this.confirmRevision};
    delete event.setting;
    const trigger = this.confirmTrigger;
    this.dismissConfirmation({restoreFocus: false, resetDraft: false});
    this.sendAction(event, trigger);
  }

  // A local preview intent asks first; the dialog shows exactly what would happen.
  requestConfirmation(intent: PreviewEvent, trigger: HTMLElement) {
    this.run(() => {
      if (!this.controlsEnabled) return;
      const ui = this.ui;
      const model = this.model;
      this.confirmRevision = model.revision;
      this.confirmAction = intent;
      this.confirmTrigger = trigger;
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
      assign(
        ui.confirmTitle,
        trunk
          ? intent.value === 'open'
            ? 'Åbn bagagerummet?'
            : 'Luk bagagerummet?'
          : access
            ? unlockTitle
            : settings
              ? intent.setting === 'temperature'
                ? `Indstil ${temperature} °C?`
                : 'Indstil sædevarme?'
              : label + '?',
      );
      const seats = intent.seats ?? {driver: 0, passenger: 0};
      const startsClimate = model.climate.status === 'off' && Object.values(seats).some(value => value > 0);
      assign(
        ui.confirmationNote,
        trunk
          ? 'Se til bilen, og hold området ved bagagerummet frit.'
          : access
            ? unlockConsequence
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
                  : 'Maksimal afrimning stoppes.',
      );
      kit(ui.lockConfirm, 'button', {
        tone: intent.action === 'lock' ? 'danger' : access ? 'warning' : 'neutral',
      });
      const icon = trunk ? 'car-front' : access ? 'lock-open' : climate ? 'power' : 'wind';
      buttonContent(ui.lockConfirm, {label, icon: `assets/icons/${icon}.svg`});
      buttonContent(ui.lockCancel, {label: 'Annuller', icon: 'assets/icons/x-lg.svg'});
      assign(ui.lockCancel, 'Annuller');
      ui.lockConfirm.hidden = false;
      ui.lockCancel.hidden = false;
      const scrollTop = this.root.scrollTop;
      this.paintNow();
      this.confirmation.showModal();
      this.root.scrollTop = scrollTop;
    });
  }

  // Draws now, inside a step, before a native action (showModal) that must see the current screen.
  private paintNow() {
    const depth = this.depth;
    this.depth = 0;
    try {
      this.paint();
    } finally {
      this.depth = depth;
    }
  }

  feedbackScopeFor(snapshot: Snapshot | null | undefined): string | null | undefined {
    if (!snapshot) return this.feedbackScope ?? null;
    let prior: unknown[] = [];
    try {
      prior = JSON.parse(this.feedbackScope || '[]') as unknown[];
    } catch {
      // An unreadable scope is no scope.
    }
    const same = prior[0] === snapshot.bootId && prior[1] === snapshot.roomId;
    return JSON.stringify([
      snapshot.bootId,
      snapshot.roomId,
      snapshot.sessionId ?? (same ? (prior[2] ?? null) : null),
      snapshot.providerGeneration ?? (same ? (prior[3] ?? null) : null),
    ]);
  }

  // ---- Render ---------------------------------------------------------------------------------------------------

  render(value?: unknown, options: VehicleRenderOptions = {}): VehicleModel {
    return this.run(() => this.renderModel(value, options));
  }

  private renderModel(
    value: unknown,
    {connected = true, connectionDetail = null, chargeContext, vehicleActions = [], feedbackScope = null}:
      VehicleRenderOptions,
  ): VehicleModel {
    const ui = this.ui;
    if (this.feedbackScope !== feedbackScope) {
      this.feedbackScope = feedbackScope;
      for (const target of [ui.accessFeedback, ui.climateFeedback]) {
        assign(target, '');
        target.hidden = true;
      }
    }
    this.vehicleActions = Array.isArray(vehicleActions) ? (vehicleActions as string[]) : [];
    this.connected = connected;
    const model = vehicleModel(value);
    const configuredUnavailable =
      model.mode === 'unconnected' &&
      chargeContext?.readGranted === true &&
      typeof chargeContext.scope === 'string' &&
      chargeContext.scope !== '' &&
      chargeContext.scope !== 'local' &&
      chargeContext.scope === chargeContext.sourceScope;
    if (!this.draft || this.draftRevision !== model.revision) {
      this.draft = {temperatureC: model.climate.targetTemperatureC, seats: {...model.climate.seats}};
      this.draftRevision = model.revision;
      if (this.unknownRevision !== model.revision) this.unknownRevision = null;
    }
    this.model = model;
    this.reconcileLiveVehicleCommands();
    setAttr(ui.hero, 'data-charging', model.charging.status === 'charging');
    if (this.root.dataset.vehicleMode !== model.mode) this.root.dataset.vehicleMode = model.mode;
    const example = String(model.mode === 'fixture');
    if (this.root.dataset.example !== example) this.root.dataset.example = example;
    setAttr(ui.hero, 'data-kit-state', model.mode === 'unconnected' ? 'unavailable' : 'ready');
    if (model.mode === 'unconnected' && !configuredUnavailable) setAttr(ui.hero, 'data-kit-variant', 'message');
    else removeAttr(ui.hero, 'data-kit-variant');
    // Live artwork is a generic illustration only for a verified model.
    const showArtwork =
      model.modelName === 'Model Y' &&
      (model.mode === 'observed' || (model.mode === 'fixture' && model.modelYear === 2023));
    const imageState = ui.figure.attrs['data-image-state'];
    ui.figure.hidden = !showArtwork;
    ui.context.hidden = !showArtwork;
    ui.heroIcon.hidden = showArtwork && imageState !== 'missing';
    ui.image.hidden = !showArtwork || imageState === 'missing';
    if (showArtwork) setAttr(ui.image, 'src', VEHICLE_ARTWORK);
    else if ('src' in ui.image.attrs) {
      removeAttr(ui.image, 'src');
      setAttr(ui.figure, 'data-image-state', 'unavailable');
    }
    // Dot car (lærred A-Tesla): body filled to the known battery level; tone follows the observed state.
    const carTone = !showArtwork
      ? 'none'
      : model.stale === true || !connected
        ? 'unknown'
        : model.charging.status === 'charging'
          ? 'charging'
          : liveClimateActive(model) || (model.mode === 'fixture' && activeClimateModes.has(model.climate.status ?? ''))
            ? 'climate'
            : 'parked';
    setAttr(ui.hero, 'data-car-tone', carTone);
    const level = finite(model.batteryPercent) ? Math.max(0, Math.min(100, model.batteryPercent)) / 100 : 0;
    ui.carLevel = String(level);
    ui.title = model.title;
    assign(ui.context, model.context);
    const status = model.status === 'Lader' ? 'Bilen lader' : model.status;
    const trunk = model.mode === 'observed' && model.access?.rearTrunk === 'open' ? 'Bagagerum åbent' : null;
    assign(ui.status, configuredUnavailable ? 'Status ukendt' : trunk ? `${status} · ${trunk}` : status);
    const updated = vehicleUpdatedLabel(model) || null;
    assign(ui.connectionNote, updated || connectionDetail || 'Tilføj i Home Assistant');
    ui.connectionNote.hidden = !updated && (model.mode !== 'unconnected' || configuredUnavailable);
    // Lærred »A-Tesla«: the number in 64 mono, » %« half size beside it (one text, two sizes).
    ui.battery =
      model.batteryPercent === null ? {number: '—', unit: false} : {number: String(model.batteryPercent), unit: true};
    ui.batteryGroup.hidden = model.batteryPercent === null;
    assign(ui.rangeValue, model.rangeKm === null ? '—' : `${model.rangeKm.toLocaleString('da-DK', {
      maximumFractionDigits: 0,
    })} km`);
    ui.rangeGroup.hidden = model.rangeKm === null;
    const known = model.batteryPercent !== null;
    setAttr(ui.rail, 'data-known', known);
    ui.rail.hidden = !known;
    ui.meter.hidden = !known;
    ui.meterValue = known ? model.batteryPercent : null;
    const charge = vehicleChargeUpdate(this.chargePresentation, model, chargeContext);
    this.chargePresentation = charge;
    if (charge.cancel || charge.cue) {
      this.chargeAnimation?.cancel();
      this.chargeAnimation = null;
    }
    if (charge.cue) ui.chargeCue++;
    const disconnected = model.mode === 'unconnected' && !configuredUnavailable;
    ui.secondary.hidden = disconnected;
    ui.history.hidden = disconnected || !model.history.length;
    const climate = disconnected ? 'Kræver tilslutning' : CLIMATE_NAMES[model.climate.status ?? ''] ?? 'Ukendt';
    assign(ui.climate.status, climate);
    // Read-only details show admitted observations, never a catalogue of promised controls.
    const charging = model.charging.status === 'charging';
    const power = charging && finite(model.charging.powerKw) ? `${da(model.charging.powerKw)} kW` : null;
    const endsAt =
      charging && finite(model.charging.endsAt)
        ? new Date(model.charging.endsAt * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'})
        : null;
    const cabinTemperature = model.climate.temperatureC;
    const temperature = finite(cabinTemperature) ? `${da(cabinTemperature)} °C` : null;
    const cabin = temperature && finite(cabinTemperature) && !disconnected ? `· kabine ${da(cabinTemperature)}°` : '';
    assign(ui.cabinValue, cabin);
    ui.cabinValue.hidden = !cabin;
    assign(ui.powerValue, power || '');
    ui.powerGroup.hidden = power === null;
    assign(ui.finishValue, endsAt || '');
    ui.finishGroup.hidden = endsAt === null;
    ui.measurements.hidden =
      disconnected || [ui.batteryGroup, ui.rangeGroup, ui.powerGroup, ui.finishGroup].every(group => group.hidden);
    ui.content.hidden = disconnected || (!showArtwork && ui.measurements.hidden);
    this.climate.values.forEach(({id}, index) => {
      const known = ({state: climate, temperature} as Record<string, string | null>)[id];
      const target = ui.climate.values[index];
      const row = ui.climate.rows[index];
      if (!target || !row) return;
      assign(target, known || '');
      row.hidden = id !== 'temperature' || !temperature;
    });
    ui.climate.body.hidden = !temperature;
    ui.climate.detail.hidden = disconnected;
    const battery = lowBattery(model);
    const climateOffered = ['climateOn', 'climateOff'].some(action => this.vehicleActions.includes(action));
    const batteryNote = battery !== null && climateOffered && !activeClimateModes.has(model.climate.status ?? '');
    const lowNote = `Lavt batteri (${String(battery)} %) · Tesla afviser måske klima`;
    assign(ui.climateBatteryNote, batteryNote ? lowNote : '');
    ui.climateBatteryNote.hidden = !batteryNote;
    for (const group of [ui.access, ui.health, ui.more]) {
      group.detail.hidden = true;
      group.body.hidden = true;
      assign(group.status, 'Ikke oplyst');
      group.values.forEach((target, index) => {
        assign(target, 'Ikke oplyst');
        const row = group.rows[index];
        if (row) row.hidden = true;
      });
    }
    if (!disconnected) {
      ui.access.detail.hidden = false;
      assign(ui.access.status, 'Ukendt');
    }
    // An observed lock state is readable; it never grants a lock command.
    if (model.mode === 'observed' && typeof model.locked === 'boolean') {
      ui.access.detail.hidden = false;
      assign(ui.access.status, model.locked ? 'Låst' : 'Ulåst');
      this.access.values.forEach(({id}, index) => {
        const row = ui.access.rows[index];
        const target = ui.access.values[index];
        if (!row || !target) return;
        row.hidden = true;
        assign(target, id === 'locks' ? (model.locked ? 'Låst' : 'Ulåst') : '');
      });
    }
    // Until a real Tesla owner is introduced, even incoming history is ignored by
    // the model. The existing timeline remains the sole future history renderer.
    this.timelineData = {
      items: model.history,
      readOnly: true,
      connected: false,
      quietStatus: true,
      state: model.history.length ? 'ready' : 'empty',
    };
    ui.timeline.hidden = !model.history.length;
    ui.empty.hidden = !!model.history.length;
    this.renderControlsNow();
    return model;
  }

  // ---- Live commands ---------------------------------------------------------------------------------------------

  async beginVehicle(action: string, trigger: Element | null, args: Args = {}): Promise<void> {
    if (this.vehicleActionBlocked(action) || this.vehicleProposal) return;
    if (climateDependents.has(action) && !liveClimateActive(this.model)) return;
    const historical = this.model.historicalFields ?? [];
    if (
      (!idempotentVehicleActions.has(action) && (ACTION_FIELDS[action] ?? []).some(f => historical.includes(f))) ||
      !this.vehicleActions.includes(action) ||
      this.model.mode !== 'observed' ||
      this.connected === false
    ) {
      return;
    }
    this.run(() => {
      this.vehiclePending = true;
      const target = this.face(trigger);
      if (target) setAttr(target, 'aria-busy', 'true');
    });
    let proposal: VehicleProposal | null | undefined;
    try {
      proposal = await this.onVehicleSetup(action, args);
    } catch {
      // A failed setup is no proposal.
    }
    const ready = this.run(() => {
      const target = this.face(trigger);
      if (target) removeAttr(target, 'aria-busy');
      this.vehiclePending = false;
      if (!proposal || this.disposed) {
        this.onVehicleCancel(proposal?.operation);
        if (!this.disposed) {
          const node = CLIMATE_ACTIONS.includes(action) ? this.climateFeedback : this.accessFeedback;
          const note = this.note(node);
          if (note.attrs['data-state'] !== 'unknown' || !faceText(note)) {
            note.hidden = false;
            setAttr(note, 'data-state', 'error');
            assign(note, 'Betjeningen kunne ikke hentes.');
          }
        }
        return null;
      }
      const c = proposal.confirmation;
      if (!c.requiresConfirmation && !c.nativeWakePossible && !c.requiresOverride) return proposal;
      this.propose(proposal, trigger);
      return null;
    });
    if (ready) await this.finishVehicle(ready, trigger);
  }

  // A live proposal is confirmed in the dialog, with the wake and earlier unresolved requests disclosed.
  private propose(proposal: VehicleProposal, trigger: Element | null) {
    const ui = this.ui;
    const c = proposal.confirmation;
    const args = c.args ?? {};
    this.vehicleProposal = proposal;
    this.vehicleTrigger = trigger;
    const unlocking = c.action === 'unlock';
    const label = c.label ?? 'undefined';
    const requested =
      c.action === 'temperature'
        ? `${label}: ${String(args.temperature).replace('.', ',')} °C`
        : ['driverSeatHeat', 'passengerSeatHeat'].includes(c.action)
          ? `${label}: ${SEAT_NAMES[String(args.option)] ?? 'undefined'}`
          : label;
    assign(ui.confirmTitle, unlocking ? unlockTitle : requested + '?');
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
    assign(
      ui.confirmationNote,
      [
        unlocking ? unlockConsequence : '',
        c.nativeWakePossible ? 'Handlingen kan vække bilen.' : '',
        effect('on') && ['driverSeatHeat', 'passengerSeatHeat', 'defrostOn'].includes(c.action)
          ? 'Handlingen kan tænde klimaet.'
          : '',
        effect('off') && c.action === 'defrostOff' ? 'Handlingen kan slukke klimaet.' : '',
        prior.length ? `Tidligere anmodninger om at ${priorText ?? ''} kan stadig blive udført senere.` : '',
        c.requiresOverride ? 'Bekræft, at du vil fortsætte.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    kit(ui.lockConfirm, 'button', {tone: unlocking ? 'danger' : 'neutral'});
    buttonContent(ui.lockConfirm, {label: c.label ?? ''});
    buttonContent(ui.lockCancel, {label: 'Annuller'});
    ui.lockConfirm.hidden = false;
    // A live confirmation can only be sent while the car is observed and PodVoice is connected.
    ui.lockConfirm.disabled = this.connected === false || this.model.mode !== 'observed';
    ui.lockCancel.hidden = false;
    this.paintNow();
    this.confirmation.showModal();
  }

  vehicleActionBlocked(action: string): boolean {
    const phase = this.liveVehicleCommands.get(vehicleActionFamily(action))?.phase;
    return this.vehiclePending || phase === 'sending' || phase === 'observing';
  }

  async finishVehicle(proposal: VehicleProposal, trigger: Element | null): Promise<void> {
    const {action, args = {}} = proposal.confirmation;
    if (this.vehicleActionBlocked(action) || this.disposed || this.connected === false) return;
    const family = vehicleActionFamily(action);
    const [field, wanted, read, label, confirmation] = liveVehicleEffects[action] ?? [];
    const model = this.model;
    const command: LiveCommand = {
      family,
      operation: proposal.operation,
      trigger,
      action,
      args,
      field,
      expected: wanted?.(args),
      read,
      label: text(label, args) ?? '',
      confirmation: text(confirmation, args) ?? '',
      previousAt: (field ? model.fieldObservedAt?.[field] : undefined) ?? model.observedAt ?? 0,
      sentAt: Date.now() / 1000,
      phase: 'sending',
      note: ['lock', 'unlock', 'rearTrunkToggle'].includes(action) ? this.accessFeedback : this.climateFeedback,
    };
    // HA did not know the field when sent (e.g. unknown after a Core restart): Tesla wakes the car.
    command.awaitingCar =
      !!field &&
      (historicalField(model, field, this.connected) ||
        vehicleFieldValue(model, field) == null ||
        ['asleep', 'offline'].includes(model.connectionState ?? ''));
    // A sleeping, offline or unknown car is woken by the command before it can answer.
    // One short line under the title; the switch itself shows the progress (fejl 11, 13 Nov).
    if (command.awaitingCar) command.label = 'Vækker bilen…';
    this.run(() => {
      this.liveVehicleCommands.set(family, command);
      this.liveVehicleFeedback.delete(family);
      assign(this.note(command.note), '');
      this.vehiclePending = true;
      this.renderControlsNow();
    });
    let result: VehicleSendResult | undefined;
    try {
      result = await this.onVehicleSend(proposal.operation);
    } catch {
      result = {status: 'unknown'};
    }
    this.run(() => {
      this.vehiclePending = false;
      if (this.disposed) return;
      this.settle(command, result);
      this.renderControlsNow();
    });
  }

  private settle(command: LiveCommand, result: VehicleSendResult | undefined) {
    const family = command.family;
    if (this.liveVehicleCommands.get(family) !== command) return;
    if (result?.error && !result.late) {
      this.finishVehicleFeedback(command, 'error', vehicleErrorTexts[result.error] ?? vehicleErrorTexts.refused ?? '');
    } else if (result?.late) {
      if (command.operation.presentationCurrent?.()) {
        this.finishVehicleFeedback(command, 'unknown', 'Udfald ukendt · kontrollér bilen.');
      } else this.clearLiveVehicleCommand(command);
    } else if (result?.status === 'accepted') {
      command.phase = 'observing';
      this.reconcileLiveVehicleCommand(command);
      if (this.liveVehicleCommands.get(family) === command) {
        command.cancelObservation = command.operation.waitForObservation?.(() => {
          this.run(() => {
            if (this.liveVehicleCommands.get(family) !== command || command.phase !== 'observing') return;
            const notDone = this.liveVehicleContradiction(command);
            if (notDone) {
              command.contradicted = true;
              this.finishVehicleFeedback(command, 'error', notDone);
            } else this.finishVehicleFeedback(command, 'unknown', 'Udfald ukendt · kontrollér bilen.');
            this.renderControlsNow();
          });
        });
      }
    } else if (result?.status === 'unknown') {
      this.finishVehicleFeedback(command, 'unknown', 'Udfald ukendt · kontrollér bilen.');
      this.reconcileLiveVehicleCommand(command);
    } else if (result?.status === 'example') {
      this.finishVehicleFeedback(command, 'ready', 'Lokalt eksempel · ingen bil betjenes.');
    } else {
      this.finishVehicleFeedback(command, 'error', 'Handlingen blev afvist.');
    }
  }

  clearLiveVehicleCommand(command: LiveCommand) {
    command.cancelObservation?.();
    command.cancelObservation = null;
    const target = this.face(command.trigger);
    if (target) removeAttr(target, 'aria-busy');
    this.liveVehicleCommands.delete(command.family);
  }

  finishVehicleFeedback(command: LiveCommand, state: NoteState, value: string) {
    this.clearLiveVehicleCommand(command);
    if (state === 'unknown') {
      command.phase = 'unknown';
      this.liveVehicleCommands.set(command.family, command);
    }
    if (command.operation.presentationCurrent) {
      this.liveVehicleFeedback.delete(command.family);
      this.liveVehicleFeedback.set(command.family, {command, state, text: value});
    }
    const note = this.note(command.note);
    setAttr(note, 'data-state', state);
    assign(note, value);
  }

  private renderLiveVehicleFeedback() {
    for (const [family, {command, state}] of this.liveVehicleFeedback) {
      if (
        !command.operation.presentationCurrent?.() ||
        (state === 'ready' && !this.liveVehicleObservationMatches(command))
      ) {
        this.liveVehicleFeedback.delete(family);
        continue;
      }
      // The car did what was asked after all: the contradiction no longer holds.
      if (command.contradicted && this.liveVehicleObservationMatches(command)) {
        this.liveVehicleFeedback.delete(family);
        continue;
      }
      // A newer observation of the field is the car's answer: "Udfald ukendt" has served its purpose.
      if (state === 'unknown' && this.liveVehicleObservedSince(command)) {
        this.liveVehicleFeedback.delete(family);
        if (this.liveVehicleCommands.get(family) === command) this.clearLiveVehicleCommand(command);
      }
    }
    for (const node of [this.accessFeedback, this.climateFeedback]) {
      const note = this.note(node);
      const entries = [...this.liveVehicleFeedback.values()].filter(row => row.command.note === node);
      if (!entries.length) {
        if (this.liveVehicleFeedbackNotes.delete(node)) assign(note, '');
        continue;
      }
      this.liveVehicleFeedbackNotes.add(node);
      const issues = entries.filter(row => row.state === 'unknown' || row.state === 'error');
      const last = entries.at(-1);
      const active = issues.length ? issues : last ? [last] : [];
      const first = active[0];
      if (!first) continue;
      setAttr(note, 'data-state', active.some(row => row.state === 'unknown') ? 'unknown' : first.state);
      const labels: Record<Family, string> = {lock: 'Lås', trunk: 'Bagagerum', climate: 'Klima'};
      assign(
        note,
        active.length === 1 ? first.text : active.map(row => labels[row.command.family] + ': ' + row.text).join(' '),
      );
    }
  }

  private reconcileLiveVehicleCommands() {
    for (const command of [...this.liveVehicleCommands.values()]) this.reconcileLiveVehicleCommand(command);
  }

  private reconcileLiveVehicleCommand(command: LiveCommand) {
    if (command.operation.presentationCurrent && !command.operation.presentationCurrent()) {
      assign(this.note(command.note), '');
      this.clearLiveVehicleCommand(command);
      return;
    }
    if (command.phase !== 'sending' && this.liveVehicleObservationMatches(command)) {
      this.finishVehicleFeedback(command, 'ready', command.confirmation);
    }
  }

  private liveVehicleObservedSince(command: LiveCommand): boolean {
    if (!command.field || this.model.mode !== 'observed') return false;
    const observedAt = this.model.fieldObservedAt?.[command.field];
    return (
      !historicalField(this.model, command.field, this.connected) &&
      finite(observedAt) &&
      observedAt > command.previousAt &&
      observedAt >= command.sentAt - CLOCK_SKEW_S
    );
  }

  // Basis for a concrete result: the car is not asleep/offline and a fresh known value
  // newer than the command differs from the target. Otherwise null ("Udfald ukendt").
  private liveVehicleContradiction(command: LiveCommand): string | null {
    const m = this.model;
    const notDone = vehicleNotDone[command.action];
    if (
      !notDone ||
      !command.read ||
      !command.field ||
      m.mode !== 'observed' ||
      m.stale ||
      ['asleep', 'offline'].includes(m.connectionState ?? '') ||
      (command.operation.observationCurrent && !command.operation.observationCurrent()) ||
      !this.liveVehicleObservedSince(command) ||
      vehicleFieldValue(m, command.field) == null ||
      this.liveVehicleObservationMatches(command)
    ) {
      return null;
    }
    const battery = command.family === 'climate' ? lowBattery(m) : null;
    return (text(notDone, command.args) ?? '') + (battery === null ? '' : ` · batteri ${String(battery)} %`);
  }

  private liveVehicleObservationMatches(command: LiveCommand): boolean {
    if (
      !command.read ||
      !command.field ||
      this.model.mode !== 'observed' ||
      (command.operation.observationCurrent && !command.operation.observationCurrent())
    ) {
      return false;
    }
    const observedAt = this.model.fieldObservedAt?.[command.field];
    return (
      !historicalField(this.model, command.field, this.connected) &&
      finite(observedAt) &&
      observedAt > command.previousAt &&
      observedAt >= command.sentAt - CLOCK_SKEW_S &&
      command.read(this.model) === command.expected
    );
  }

  private renderLiveVehicleCommands() {
    for (const command of this.liveVehicleCommands.values()) {
      if (command.phase !== 'unknown') this.renderLiveVehicleCommand(command);
    }
  }

  private renderLiveVehicleCommand(command: LiveCommand) {
    const {trigger, action, label} = command;
    const note = this.note(command.note);
    const target = this.face(trigger);
    const button = trigger?.tagName === 'BUTTON' && !!target;
    // The climate switch shows progress itself; its status is one line under the title (fejl 11).
    const named = button && target.attrs['data-kit-variant'] !== 'icon' && target.attrs['data-kit'] !== 'toggle';
    if (!named) {
      setAttr(note, 'data-state', 'pending');
      assign(note, label);
    }
    if (!button || !this.vehicleActions.includes(action)) return;
    if ((action === 'lock' || action === 'unlock') && trigger === this.liveVehicleButtons[action]) {
      target.hidden = false;
      this.ui.live[action === 'unlock' ? 'lock' : 'unlock'].hidden = true;
      kit(target, 'button', {variant: 'secondary', tone: 'neutral'});
    }
    kit(target, target.attrs['data-kit'] === 'toggle' ? 'toggle' : 'button', {feedback: 'progress', loading: true});
    target.disabled = true;
    if (named) buttonContent(target, {label});
  }

  dismissConfirmation({restoreFocus = true, resetDraft = true}: {restoreFocus?: boolean; resetDraft?: boolean} = {}) {
    this.run(() => {
      const ui = this.ui;
      const model = this.model as VehicleModel | undefined;
      if (resetDraft && !this.pending && model) {
        this.draft = {temperatureC: model.climate.targetTemperatureC, seats: {...model.climate.seats}};
      }
      const trigger = this.confirmTrigger;
      this.confirmTrigger = null;
      this.confirmAction = null;
      this.confirmRevision = null;
      ui.lockConfirm.hidden = true;
      ui.lockCancel.hidden = true;
      if (this.confirmation.open) this.confirmation.close();
      if (resetDraft && !this.pending && model) {
        const target = model.climate.targetTemperatureC;
        assign(ui.temperatureValue, finite(target) ? `${da(target)} °C` : '—');
        for (const seat of SEATS) this.seatGroups[seat].setValue(model.climate.seats?.[seat] ?? 0);
      }
      if (restoreFocus && !this.disposed) trigger?.focus({preventScroll: true});
    });
  }

  hasDraft(): boolean {
    const m = this.model;
    const draft = this.draft;
    if (!draft) return true;
    return (
      draft.temperatureC !== m.climate.targetTemperatureC ||
      SEATS.some(seat => draft.seats[seat] !== m.climate.seats?.[seat])
    );
  }

  // ---- Local preview ---------------------------------------------------------------------------------------------

  sendAction(event: PreviewEvent, trigger: Element | null | undefined) {
    this.run(() => {
      this.sendPreview(event, trigger);
    });
  }

  private sendPreview(event: PreviewEvent, trigger: Element | null | undefined) {
    if (!this.controlsEnabled || this.pending) return;
    const seat = SEATS.find(name => this.seatGroups[name].inputs.some(input => input === trigger));
    const level = seat ? LEVELS[event.seats?.[seat] ?? -1] ?? 'undefined' : '';
    const label = seat
      ? `${seat === 'driver' ? 'Fører' : 'Passager'}: ${level}`
      : Number.isInteger(event.temperatureC)
        ? `${String(event.temperatureC)} °C`
        : '';
    const operation: PendingPreview = {
      trigger,
      label,
      intentValue: event.value,
      revision: event.revision,
      controller: new AbortController(),
    };
    this.pending = operation;
    this.commandNote =
      trigger === this.lockButton || trigger === this.rearTrunkButton ? this.accessFeedback : this.climateFeedback;
    this.commandResult = null;
    this.renderControlsNow();
    const progress = ({phase}: {phase?: string} = {}) => {
      this.run(() => {
        if (this.pending !== operation || this.disposed) return;
        operation.phase = phase === 'waking' ? 'waking' : 'awaiting';
        this.renderControlsNow();
      });
    };
    let result: PreviewOutcome;
    try {
      result = this.onAction(event, {signal: operation.controller.signal, onProgress: progress});
    } catch {
      result = {status: 'unknown'};
    }
    const finish = (outcome: PreviewResult | undefined) => {
      this.run(() => {
        if (this.pending !== operation || this.disposed) return;
        this.pending = null;
        const model = this.model;
        const same = model.mode === 'fixture' && model.revision === operation.revision;
        const confirmed =
          outcome?.status === 'confirmed' &&
          outcome.revision === model.revision &&
          model.revision === (operation.revision ?? NaN) + 1;
        if (!same && !confirmed) {
          this.commandResult = null;
          this.dismissConfirmation();
          this.renderControlsNow();
          return;
        }
        this.commandTarget = trigger;
        this.commandResult = confirmed ? 'confirmed' : outcome?.status === 'failed' ? 'failed' : 'unknown';
        if (this.commandResult === 'unknown') this.unknownRevision = operation.revision;
        this.dismissConfirmation();
        this.renderControlsNow();
      });
    };
    // A synchronous legacy preview callback is not proof of a vehicle outcome.
    if (isThenable(result)) {
      result.then(finish, () => {
        finish({status: 'unknown'});
      });
    } else if (result) finish(result);
    else {
      this.pending = null;
      this.dismissConfirmation();
      this.renderControlsNow();
    }
  }

  // ---- Controls' state --------------------------------------------------------------------------------------------

  renderControls() {
    this.run(() => {
      this.renderControlsNow();
    });
  }

  private renderControlsNow() {
    this.renderControlStates();
    this.renderAccessTiles();
  }

  // Adgang as action surfaces (lærred K-ActionTile): what the button acts on and its observed state, drawn by CSS
  // from data attributes, so the action label stays the button's only text and accessible name.
  private renderAccessTiles() {
    const m = this.model as VehicleModel | undefined;
    if (!m) return;
    const ui = this.ui;
    const defrost = m.climate.defrost === true ? 'on' : m.climate.defrost === false ? 'off' : 'unknown';
    setAttr(ui.defrostButton, 'data-defrost', defrost);
    const door = m.locked === true ? 'Låst' : m.locked === false ? 'Ulåst' : 'Ukendt';
    const trunk = m.access?.rearTrunk;
    const trunkText = trunk === 'open' ? 'Åbent' : trunk === 'closed' ? 'Lukket' : 'Ukendt';
    const unlocked = m.locked === false;
    const tiles: [Face, string, string, boolean][] = [
      ...[ui.lockButton, ui.live.lock, ui.live.unlock].map(
        (target): [Face, string, string, boolean] => [target, 'Døre', door, unlocked],
      ),
      [ui.rearTrunkButton, 'Bagagerum', trunkText, trunk === 'open'],
    ];
    // The trunk seen from the side (lærred A-Tesla), open or closed as observed; the action label is kept.
    const trunkIcon = `assets/icons/${trunk === 'open' ? 'car-trunk-open' : 'car-trunk'}.svg`;
    const trunkLabel = faceText(ui.rearTrunkButton);
    if (trunkLabel) buttonContent(ui.rearTrunkButton, {label: trunkLabel, icon: trunkIcon});
    for (const [target, name, value, attention] of tiles) {
      setAttr(target, 'data-vehicle-tile', attention ? 'attention' : 'calm');
      setAttr(target, 'data-tile-name', name);
      setAttr(target, 'data-tile-value', value);
    }
  }

  private renderControlStates() {
    const ui = this.ui;
    // An open live confirmation follows its dependency: disabled while disconnected or not observed.
    if (this.vehicleProposal) ui.lockConfirm.disabled = this.connected === false || this.model.mode !== 'observed';
    const m = this.model;
    const offered = (action: string) => this.vehicleActions.includes(action);
    const liveEnabled = m.mode === 'observed' && this.connected !== false && !this.disposed;
    const freshClimate = liveEnabled && m.climate.status !== null;
    const climateIntent = freshClimate ? (m.climate.status === 'off' ? 'climateOn' : 'climateOff') : null;
    const useClimateToggle = !!climateIntent && offered(climateIntent);
    for (const action of LIVE_ACTIONS) {
      const target = ui.live[action];
      const irrelevant =
        (action === 'lock' && m.locked === true) ||
        (action === 'unlock' && m.locked === false) ||
        (action === 'climateOn' && m.climate.status !== null && m.climate.status !== 'off') ||
        (action === 'climateOff' && m.climate.status === 'off');
      target.hidden =
        !liveEnabled ||
        !offered(action) ||
        irrelevant ||
        (useClimateToggle && (action === 'climateOn' || action === 'climateOff'));
      if (action === 'lock' || action === 'unlock') {
        kit(target, 'button', {
          variant: action === 'unlock' ? 'primary' : 'secondary',
          tone: action === 'unlock' ? 'danger' : 'neutral',
          loading: false,
        });
      }
      if (!target.hidden) {
        const icon = action === 'unlock' ? 'lock-open' : action === 'lock' ? 'lock' : 'power';
        buttonContent(target, {label: target.attrs['data-live-vehicle-label'] ?? '', icon: `assets/icons/${icon}.svg`});
      }
      target.disabled = this.vehicleActionBlocked(action);
    }
    if (liveEnabled && (offered('lock') || offered('unlock'))) ui.access.detail.hidden = false;
    if (liveEnabled && (offered('climateOn') || offered('climateOff'))) ui.climate.detail.hidden = false;
    const enabled = m.mode === 'fixture' && m.controlsPreview === true;
    const pending = !!this.pending;
    const unknown = this.unknownRevision === m.revision;
    setAttr(
      ui.climate.detail,
      'data-kit-layout',
      enabled || (liveEnabled && (offered('climateOn') || offered('climateOff'))) ? 'header-action' : 'default',
    );
    this.controlsEnabled = enabled && this.connected !== false && !this.disposed && !pending && !unknown;
    this.settingsEnabled = this.controlsEnabled && m.climate.status !== 'off';
    if (
      !this.vehicleProposal &&
      (!enabled || this.connected === false || this.confirmRevision !== m.revision) &&
      !pending
    ) {
      this.dismissConfirmation();
    }
    for (const target of [ui.climateToggle, ui.climateActions, ui.temperatureControls, ui.lockControls,
      ui.seatControls.node]) target.hidden = !enabled;
    for (const target of [ui.climateToggle, ui.defrostButton, ui.temperatureDown, ui.temperatureUp, ui.lockButton,
      ui.rearTrunkButton]) {
      target.disabled = !this.controlsEnabled;
      removeAttr(target, 'aria-busy');
      removeAttr(target, 'data-state');
    }
    ui.defrostButton.hidden = false;
    this.seatControls.setDisabled(enabled ? m.climate.status === 'off' : !liveClimateActive(m));
    for (const seat of SEATS) {
      const group = this.seatGroups[seat];
      group.setDisabled(!this.settingsEnabled);
      for (const target of ui.seatGroups[seat].inputs) target.disabled = !this.settingsEnabled;
      group.setValue(m.climate.seats?.[seat] ?? 0);
    }
    if (liveEnabled) this.renderLiveControls(useClimateToggle);
    this.renderLiveVehicleFeedback();
    if (liveEnabled) this.renderLiveVehicleCommands();
    if (!enabled) {
      ui.access.status.hidden = false;
      ui.climate.status.hidden = false;
      this.commandResult = null;
      for (const [group, note] of [[ui.access, ui.accessFeedback], [ui.climate, ui.climateFeedback]] as const) {
        note.hidden = !faceText(note);
        if (!note.hidden) {
          group.detail.hidden = false;
          ui.secondary.hidden = false;
        }
      }
      return;
    }
    this.renderPreviewControls(pending, unknown);
  }

  // Observed car: only offered actions on fresh, known state; the switch, temperature, defrost, trunk and seats.
  private renderLiveControls(useClimateToggle: boolean) {
    const ui = this.ui;
    const m = this.model;
    const offered = (action: string) => this.vehicleActions.includes(action);
    const historical = m.historicalFields ?? [];
    ui.climateToggle.hidden = !useClimateToggle;
    ui.climateToggle.disabled = this.vehicleActionBlocked('climateOn');
    if (useClimateToggle) powerToggle(ui.climateToggle, {checked: m.climate.status !== 'off'});
    const c = m.climate;
    const t = c.targetTemperatureC;
    const validTemp =
      !m.stale &&
      !TEMPERATURE_FIELDS.some(field => historical.includes(field)) &&
      activeClimateModes.has(c.status ?? '') &&
      offered('temperature') &&
      c.temperatureStepC === 0.5 &&
      finite(t) &&
      t * 2 === Math.round(t * 2) &&
      finite(c.minTemperatureC) &&
      finite(c.maxTemperatureC) &&
      c.minTemperatureC <= t &&
      t <= c.maxTemperatureC;
    ui.temperatureControls.hidden = !offered('temperature');
    if (offered('temperature')) {
      assign(ui.temperatureValue, finite(t) ? `${da(t)} °C` : '—');
      const blocked = !validTemp || this.vehicleActionBlocked('climateOn');
      ui.temperatureDown.disabled = blocked || t - 0.5 < Number(c.minTemperatureC);
      ui.temperatureUp.disabled = blocked || t + 0.5 > Number(c.maxTemperatureC);
      ui.climate.detail.hidden = false;
    }
    const defrostAction = c.defrost === true ? 'defrostOff' : c.defrost === false ? 'defrostOn' : null;
    ui.climateActions.hidden = !['defrostOn', 'defrostOff'].some(offered);
    ui.defrostButton.hidden = ui.climateActions.hidden;
    ui.defrostButton.disabled =
      !liveClimateActive(m) ||
      !defrostAction ||
      !!m.stale ||
      historical.includes('climate.defrost') ||
      !offered(defrostAction) ||
      this.vehicleActionBlocked('climateOn');
    if (!ui.climateActions.hidden) {
      const label = c.defrost === true ? 'Stop afrimning' : c.defrost === false ? 'Afrim ruder' : 'Afrimning ukendt';
      buttonContent(ui.defrostButton, {label, icon: 'assets/icons/wind.svg'});
      ui.climate.detail.hidden = false;
    }
    ui.lockControls.hidden = !['rearTrunkToggle', 'lock', 'unlock'].some(offered);
    ui.lockButton.hidden = true;
    ui.rearTrunkButton.hidden = !offered('rearTrunkToggle');
    const trunk = m.access?.rearTrunk;
    ui.rearTrunkButton.disabled =
      ui.rearTrunkButton.hidden ||
      this.vehicleActionBlocked('rearTrunkToggle') ||
      historical.includes('trunk') ||
      !['open', 'closed'].includes(trunk ?? '');
    if (!ui.rearTrunkButton.hidden) {
      const label = trunk === 'closed' ? 'Åbn bagagerum' : trunk === 'open' ? 'Luk bagagerum' : 'Bagagerum ukendt';
      buttonContent(ui.rearTrunkButton, {label, icon: 'assets/icons/car-front.svg'});
      ui.access.detail.hidden = false;
    }
    let seatsVisible = false;
    for (const seat of SEATS) {
      const group = this.seatGroups[seat];
      const faces = ui.seatGroups[seat];
      const action = seat === 'driver' ? 'driverSeatHeat' : 'passengerSeatHeat';
      const current = SEAT_LEVELS.indexOf(seatHeat(m, seat) ?? '');
      faces.node.hidden = !offered(action) || current < 0;
      const disabled =
        !liveClimateActive(m) ||
        faces.node.hidden ||
        this.vehicleActionBlocked('climateOn') ||
        historical.includes(`climate.${seat}SeatHeat`);
      group.setDisabled(disabled);
      for (const target of faces.inputs) target.disabled = disabled;
      if (!faces.node.hidden) {
        group.setValue(current);
        seatsVisible = true;
      }
    }
    ui.seatControls.node.hidden = !seatsVisible;
    if (seatsVisible) {
      ui.climate.detail.hidden = false;
      const description = !m.stale
        ? SEATS.flatMap(seat => {
            const level = SEAT_NAMES[seatHeat(m, seat) ?? ''];
            return level ? [`${seat === 'driver' ? 'Fører' : 'Passager'}: ${level}`] : [];
          }).join(' · ')
        : '';
      this.seatControls.setDescription(this.seatExpanded ? '' : description);
    }
  }

  // Local fixture with preview controls: explicit, confirmed where the car would act, never sent to a car.
  private renderPreviewControls(pending: boolean, unknown: boolean) {
    const ui = this.ui;
    const m = this.model;
    const target = m.climate.targetTemperatureC ?? NaN;
    ui.climate.detail.hidden = false;
    ui.access.detail.hidden = false;
    const trunkOpen = m.access?.rearTrunk === 'open';
    assign(ui.access.status, `${trunkOpen ? 'Bagagerum åbent · ' : ''}${m.locked ? 'Låst' : 'Ulåst'}`);
    removeAttr(ui.climateToggle, 'data-selected');
    powerToggle(ui.climateToggle, {checked: m.climate.status !== 'off'});
    kit(ui.lockButton, 'button', {
      variant: m.locked ? 'primary' : 'secondary',
      tone: m.locked ? 'danger' : 'neutral',
    });
    assign(ui.temperatureValue, `${String(m.climate.targetTemperatureC)} °C`);
    setAttr(ui.defrostButton, 'data-selected', String(m.climate.defrost));
    assign(ui.defrostButton, m.climate.defrost ? 'Stop afrimning' : 'Afrim ruder');
    ui.temperatureDown.disabled = !this.settingsEnabled || target <= 16;
    ui.temperatureUp.disabled = !this.settingsEnabled || target >= 30;
    ui.defrostButton.disabled = !this.settingsEnabled;
    assign(ui.temperatureDown, '−');
    assign(ui.temperatureUp, '+');
    buttonContent(ui.lockButton, {
      label: m.locked ? 'Lås op' : 'Lås bilen',
      icon: `assets/icons/${m.locked ? 'lock-open' : 'lock'}.svg`,
    });
    buttonContent(ui.rearTrunkButton, {
      label: trunkOpen ? 'Luk bagagerum' : 'Åbn bagagerum',
      icon: 'assets/icons/car-front.svg',
    });
    buttonContent(ui.defrostButton, {
      label: m.climate.defrost ? 'Stop afrimning' : 'Afrim ruder',
      icon: 'assets/icons/wind.svg',
    });
    const seats = m.climate.seats ?? {driver: 0, passenger: 0};
    this.seatControls.setDescription(
      this.seatExpanded
        ? ''
        : `Fører: ${LEVELS[seats.driver] ?? 'Fra'} · Passager: ${LEVELS[seats.passenger] ?? 'Fra'}`,
    );
    const commandNote = this.note(this.commandNote);
    for (const note of [ui.accessFeedback, ui.climateFeedback]) {
      note.hidden = false;
      if (note !== commandNote) assign(note, '');
    }
    setAttr(
      commandNote,
      'data-state',
      pending ? 'pending' : this.commandResult === 'failed' ? 'error' : unknown ? 'unknown' : 'ready',
    );
    const current = this.pending;
    const inlinePending = current?.trigger?.tagName === 'INPUT';
    assign(
      commandNote,
      current && inlinePending
        ? `${current.label} · ${current.phase === 'waking' ? 'vækker bilen…' : 'afventer svar…'}`
        : unknown
          ? 'Svar mangler · Kontrollér bilen før en ny kommando.'
          : this.commandResult === 'failed'
            ? 'Afvist · Prøv igen.'
            : '',
    );
    for (const [group, note] of [[ui.access, ui.accessFeedback], [ui.climate, ui.climateFeedback]] as const) {
      note.hidden = !faceText(note);
      group.status.hidden = !note.hidden;
    }
    ui.lockConfirm.disabled = pending || !this.controlsEnabled;
    removeAttr(ui.lockConfirm, 'aria-busy');
    if (this.commandResult === 'failed') {
      const failed = this.face(this.commandTarget);
      if (failed) setAttr(failed, 'data-state', 'error');
    }
    if (current) {
      const trigger = this.face(current.trigger);
      if (current.trigger?.tagName === 'BUTTON' && trigger) {
        setAttr(trigger, 'aria-busy', 'true');
        trigger.disabled = true;
      }
      assign(ui.lockCancel, 'Luk');
    }
  }

  cleanup() {
    this.run(() => {
      for (const target of [this.ui.accessFeedback, this.ui.climateFeedback]) {
        assign(target, '');
        target.hidden = true;
      }
      this.disposed = true;
      for (const command of this.liveVehicleCommands.values()) this.clearLiveVehicleCommand(command);
      this.pending?.controller.abort();
      this.pending = null;
      this.dismissConfirmation();
      this.chargeAnimation?.cancel();
      this.chargeAnimation = null;
      this.chargePresentation = null;
      for (const [target, type, listener] of this.nativeListeners) target.removeEventListener(type, listener);
      this.nativeListeners.length = 0;
    });
  }
}
