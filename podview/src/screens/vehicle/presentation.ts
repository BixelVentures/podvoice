// What each element of the vehicle screen shows, as a pure function of the store's state: the same texts, kit
// attributes and visibility the previous renderer gave them, in the same precedence (the model's facts, then the
// live controls, then the running command, then the local preview).
import {VEHICLE_ARTWORK, vehicleUpdatedLabel} from './model';
import {
  CLIMATE_NAMES,
  LEVELS,
  LIVE_ACTIONS,
  SEATS,
  SEAT_LEVELS,
  SEAT_NAMES,
  TEMPERATURE_FIELDS,
  activeClimateModes,
  da,
  finite,
  isSeatControl,
  liveClimateActive,
  lowBattery,
  namedButton,
  seatHeat,
} from './rules';
import type {ButtonControl, Control, LiveAction, NoteKey, Seat} from './rules';
import {
  actionBlocked,
  controlsEnabled,
  defrostDisabled,
  liveEnabled,
  offered,
  previewEnabled,
  seatLevel,
  seatsDisabled,
  settingsEnabled,
} from './store';
import type {DialogContent, Note, VehicleState} from './store';

export type Tone = 'neutral' | 'warning' | 'danger';

export interface ButtonView {
  hidden: boolean;
  disabled: boolean;
  // The kit's icon + label anatomy; null keeps the button's plain text (`text`).
  label: string | null;
  icon: string | undefined;
  text: string;
  variant: string;
  tone: Tone | undefined;
  busy: 'true' | 'false' | undefined;
  feedback: 'progress' | undefined;
  state: 'error' | undefined;
  // The access tiles' observed state (lærred K-ActionTile).
  tile: {name: string; value: string; attention: boolean} | undefined;
  defrost: 'on' | 'off' | 'unknown' | undefined;
  selected: string | undefined;
  checked: boolean | undefined;
}

export interface FactGroupView {
  detailHidden: boolean;
  status: string;
  statusHidden: boolean;
  bodyHidden: boolean;
  values: {text: string; hidden: boolean}[];
}

export interface SeatGroupView {
  hidden: boolean;
  disabled: boolean;
  value: number;
}

export interface VehicleView {
  mode: string;
  example: boolean;
  title: string;
  hero: {
    charging: boolean;
    kitState: 'unavailable' | 'ready';
    message: boolean;
    carTone: string;
    carLevel: string;
  };
  status: string;
  connectionNote: {text: string; hidden: boolean};
  contentHidden: boolean;
  figure: {hidden: boolean; imageState: string | undefined};
  image: {hidden: boolean; src: string | undefined};
  context: {text: string; hidden: boolean};
  measurementsHidden: boolean;
  battery: {hidden: boolean; number: string; unit: boolean};
  range: {hidden: boolean; text: string};
  cabin: {hidden: boolean; text: string};
  power: {hidden: boolean; text: string};
  finish: {hidden: boolean; text: string};
  rail: {hidden: boolean; known: boolean};
  meter: {hidden: boolean; value: number | undefined};
  heroIconHidden: boolean;
  secondaryHidden: boolean;
  access: FactGroupView;
  climate: FactGroupView & {layout: 'header-action' | 'default'};
  notes: Record<NoteKey, Note & {hidden: boolean}>;
  climateBatteryNote: {text: string; hidden: boolean};
  climateToggle: ButtonView;
  temperatureControlsHidden: boolean;
  temperatureValue: string;
  temperatureDown: ButtonView;
  temperatureUp: ButtonView;
  live: Record<LiveAction, ButtonView>;
  lockControlsHidden: boolean;
  lockButton: ButtonView;
  rearTrunkButton: ButtonView;
  climateActionsHidden: boolean;
  defrostButton: ButtonView;
  seats: {
    hidden: boolean;
    expanded: boolean;
    disabled: boolean;
    description: string;
    groups: Record<Seat, SeatGroupView>;
  };
  historyHidden: boolean;
  timelineHidden: boolean;
  emptyHidden: boolean;
  dialog: DialogContent;
  dialogOpen: boolean;
  confirm: ButtonView;
  cancel: ButtonView;
}

const button = (variant: string, patch: Partial<ButtonView> = {}): ButtonView => ({
  hidden: false,
  disabled: false,
  label: null,
  icon: undefined,
  text: '',
  variant,
  tone: undefined,
  busy: undefined,
  feedback: undefined,
  state: undefined,
  tile: undefined,
  defrost: undefined,
  selected: undefined,
  checked: undefined,
  ...patch,
});
const icon = (name: string) => `assets/icons/${name}.svg`;
const NO_DIALOG: DialogContent = {
  title: '',
  note: '',
  confirmLabel: '',
  confirmIcon: undefined,
  confirmTone: 'neutral',
  cancelIcon: undefined,
};
const LIVE_GLYPHS: Record<LiveAction, string> = {lock: 'lock', unlock: 'lock-open', climateOn: 'power', climateOff: 'power'};
const LIVE_LABELS: Record<LiveAction, string> = {
  lock: 'Lås bilen',
  unlock: 'Lås op',
  climateOn: 'Tænd klima',
  climateOff: 'Sluk klima',
};

// eslint-disable-next-line complexity -- one ordered projection, as the previous renderer's render pass
export function presentVehicle(state: VehicleState): VehicleView {
  const m = state.model;
  const connected = state.input.connected;
  const configuredUnavailable = state.configuredUnavailable;
  const disconnected = m.mode === 'unconnected' && !configuredUnavailable;
  const live = liveEnabled(state);
  const enabled = previewEnabled(state);
  const controls = controlsEnabled(state);
  const settings = settingsEnabled(state);
  const wants = (action: string) => offered(state, action);
  const historical = m.historicalFields ?? [];

  // ---- Hero ----
  const artwork = state.artwork;
  const imageState = state.imageState;
  const charging = m.charging.status === 'charging';
  const carTone = !artwork
    ? 'none'
    : m.stale === true || !connected
      ? 'unknown'
      : charging
        ? 'charging'
        : liveClimateActive(m) || (m.mode === 'fixture' && activeClimateModes.has(m.climate.status ?? ''))
          ? 'climate'
          : 'parked';
  const level = finite(m.batteryPercent) ? Math.max(0, Math.min(100, m.batteryPercent)) / 100 : 0;
  const shownStatus = m.status === 'Lader' ? 'Bilen lader' : m.status;
  const trunkOpen = m.mode === 'observed' && m.access?.rearTrunk === 'open' ? 'Bagagerum åbent' : null;
  // When the shown values were last reported by the car (Tesla's own block timestamps only).
  const updated = vehicleUpdatedLabel(m);
  const power = charging && finite(m.charging.powerKw) ? `${da(m.charging.powerKw)} kW` : null;
  const endsAt =
    charging && finite(m.charging.endsAt)
      ? new Date(m.charging.endsAt * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'})
      : null;
  const cabinTemperature = m.climate.temperatureC;
  const temperature = finite(cabinTemperature) ? `${da(cabinTemperature)} °C` : null;
  const cabin = temperature && finite(cabinTemperature) && !disconnected ? `· kabine ${da(cabinTemperature)}°` : '';
  const known = m.batteryPercent !== null;
  const metricsHidden = [m.batteryPercent === null, m.rangeKm === null, power === null, endsAt === null];
  const measurementsHidden = disconnected || metricsHidden.every(Boolean);

  // ---- Groups ----
  const climateText = disconnected ? 'Kræver tilslutning' : (CLIMATE_NAMES[m.climate.status ?? ''] ?? 'Ukendt');
  const access: FactGroupView = {
    detailHidden: disconnected,
    status: disconnected ? 'Ikke oplyst' : 'Ukendt',
    statusHidden: false,
    bodyHidden: true,
    values: [0, 1, 2].map(() => ({text: 'Ikke oplyst', hidden: true})),
  };
  // An observed lock state is readable; it never grants a lock command.
  if (m.mode === 'observed' && typeof m.locked === 'boolean') {
    const lock = m.locked ? 'Låst' : 'Ulåst';
    access.detailHidden = false;
    access.status = lock;
    access.values = [lock, '', ''].map(value => ({text: value, hidden: true}));
  }
  const climate: VehicleView['climate'] = {
    detailHidden: disconnected,
    status: climateText,
    statusHidden: false,
    bodyHidden: !temperature,
    values: [climateText, temperature ?? '', '', ''].map((value, index) => ({
      text: value,
      hidden: index !== 1 || !temperature,
    })),
    layout:
      enabled || (live && (wants('climateOn') || wants('climateOff'))) ? 'header-action' : 'default',
  };
  const battery = lowBattery(m);
  const climateOffered = ['climateOn', 'climateOff'].some(wants);
  const batteryNote = battery !== null && climateOffered && !activeClimateModes.has(m.climate.status ?? '');

  // ---- Controls: their resting state ----
  const freshClimate = live && m.climate.status !== null;
  const climateIntent = freshClimate ? (m.climate.status === 'off' ? 'climateOn' : 'climateOff') : null;
  const useClimateToggle = !!climateIntent && wants(climateIntent);
  const checked = m.climate.status !== null && m.climate.status !== 'off';
  const climateToggle = button('power', {
    hidden: !enabled,
    disabled: !controls,
    label: checked ? 'Tændt' : 'Slukket',
    icon: icon('power'),
    feedback: 'progress',
    checked,
  });
  const liveButtons = Object.fromEntries(
    LIVE_ACTIONS.map(action => {
      const irrelevant =
        (action === 'lock' && m.locked === true) ||
        (action === 'unlock' && m.locked === false) ||
        (action === 'climateOn' && m.climate.status !== null && m.climate.status !== 'off') ||
        (action === 'climateOff' && m.climate.status === 'off');
      const hidden =
        !live ||
        !wants(action) ||
        irrelevant ||
        (useClimateToggle && (action === 'climateOn' || action === 'climateOff'));
      const lockFamily = action === 'lock' || action === 'unlock';
      const glyph = LIVE_GLYPHS[action];
      return [
        action,
        button(action === 'unlock' ? 'primary' : 'secondary', {
          hidden,
          disabled: actionBlocked(state, action),
          label: hidden ? null : LIVE_LABELS[action],
          icon: hidden ? undefined : icon(glyph),
          tone: lockFamily ? (action === 'unlock' ? 'danger' : 'neutral') : undefined,
          busy: lockFamily ? 'false' : undefined,
        }),
      ];
    }),
  ) as Record<LiveAction, ButtonView>;
  const lockButton = button(enabled ? (m.locked ? 'primary' : 'secondary') : 'secondary', {
    hidden: live,
    disabled: !controls,
    feedback: 'progress',
    tone: enabled ? (m.locked ? 'danger' : 'neutral') : undefined,
    ...(enabled ? {label: m.locked ? 'Lås op' : 'Lås bilen', icon: icon(m.locked ? 'lock-open' : 'lock')} : {}),
  });
  const trunk = m.access?.rearTrunk;
  const rearTrunkButton = button('secondary', {disabled: !controls, feedback: 'progress'});
  const defrostButton = button('secondary', {
    disabled: defrostDisabled(state),
    feedback: 'progress',
    text: 'Afrim ruder',
    defrost: m.climate.defrost === true ? 'on' : m.climate.defrost === false ? 'off' : 'unknown',
  });
  const temperatureDown = button('icon', {disabled: !controls, label: '−', feedback: 'progress'});
  const temperatureUp = button('icon', {disabled: !controls, label: '+', feedback: 'progress'});
  const target = m.climate.targetTemperatureC;
  let temperatureValue = finite(target) ? `${da(target)} °C` : '—';
  let temperatureControlsHidden = !enabled;
  let lockControlsHidden = !enabled;
  let climateActionsHidden = !enabled;
  let seatsHidden = !enabled;
  const disabledSeats = seatsDisabled(state);
  const groups = Object.fromEntries(
    SEATS.map(seat => [seat, {hidden: false, disabled: !settings, value: seatLevel(state, seat)}]),
  ) as Record<Seat, SeatGroupView>;
  let description = '';
  if (live && (wants('lock') || wants('unlock'))) access.detailHidden = false;
  if (live && climateOffered) climate.detailHidden = false;

  // ---- Observed car: only offered actions on fresh, known state ----
  if (live) {
    climateToggle.hidden = !useClimateToggle;
    climateToggle.disabled = actionBlocked(state, 'climateOn');
    const c = m.climate;
    const t = c.targetTemperatureC;
    const validTemp =
      !m.stale &&
      !TEMPERATURE_FIELDS.some(name => historical.includes(name)) &&
      activeClimateModes.has(c.status ?? '') &&
      wants('temperature') &&
      c.temperatureStepC === 0.5 &&
      finite(t) &&
      t * 2 === Math.round(t * 2) &&
      finite(c.minTemperatureC) &&
      finite(c.maxTemperatureC) &&
      c.minTemperatureC <= t &&
      t <= c.maxTemperatureC;
    temperatureControlsHidden = !wants('temperature');
    if (wants('temperature')) {
      temperatureValue = finite(t) ? `${da(t)} °C` : '—';
      const blocked = !validTemp || actionBlocked(state, 'climateOn');
      temperatureDown.disabled = blocked || (t ?? NaN) - 0.5 < Number(c.minTemperatureC);
      temperatureUp.disabled = blocked || (t ?? NaN) + 0.5 > Number(c.maxTemperatureC);
      climate.detailHidden = false;
    }
    climateActionsHidden = !['defrostOn', 'defrostOff'].some(wants);
    defrostButton.hidden = climateActionsHidden;
    if (!climateActionsHidden) {
      defrostButton.label = c.defrost === true ? 'Stop afrimning' : c.defrost === false ? 'Afrim ruder' : 'Afrimning ukendt';
      defrostButton.icon = icon('wind');
      climate.detailHidden = false;
    }
    lockControlsHidden = !['rearTrunkToggle', 'lock', 'unlock'].some(wants);
    lockButton.hidden = true;
    rearTrunkButton.hidden = !wants('rearTrunkToggle');
    rearTrunkButton.disabled =
      rearTrunkButton.hidden ||
      actionBlocked(state, 'rearTrunkToggle') ||
      historical.includes('trunk') ||
      !['open', 'closed'].includes(trunk ?? '');
    if (!rearTrunkButton.hidden) {
      rearTrunkButton.label = trunk === 'closed' ? 'Åbn bagagerum' : trunk === 'open' ? 'Luk bagagerum' : 'Bagagerum ukendt';
      access.detailHidden = false;
    }
    let seatsVisible = false;
    for (const seat of SEATS) {
      const action = seat === 'driver' ? 'driverSeatHeat' : 'passengerSeatHeat';
      const level = SEAT_LEVELS.indexOf(seatHeat(m, seat) ?? '');
      const group = groups[seat];
      group.hidden = !wants(action) || level < 0;
      group.disabled =
        !liveClimateActive(m) ||
        group.hidden ||
        actionBlocked(state, 'climateOn') ||
        historical.includes(`climate.${seat}SeatHeat`);
      if (!group.hidden) seatsVisible = true;
    }
    seatsHidden = !seatsVisible;
    if (seatsVisible) {
      climate.detailHidden = false;
      description = !m.stale
        ? SEATS.flatMap(seat => {
            const name = SEAT_NAMES[seatHeat(m, seat) ?? ''];
            return name ? [`${seat === 'driver' ? 'Fører' : 'Passager'}: ${name}`] : [];
          }).join(' · ')
        : '';
    }
    // The running commands: the trigger shows the progress, the opposite lock action makes way.
    for (const command of Object.values(state.commands)) {
      if (command.phase === 'unknown') continue;
      const view = buttonFor(command.trigger);
      if (!view || !wants(command.action)) continue;
      if ((command.action === 'lock' || command.action === 'unlock') && command.trigger === command.action) {
        view.hidden = false;
        liveButtons[command.action === 'unlock' ? 'lock' : 'unlock'].hidden = true;
        view.variant = 'secondary';
        view.tone = 'neutral';
      }
      view.feedback = 'progress';
      view.busy = 'true';
      view.disabled = true;
      if (namedButton(command.trigger)) {
        view.label = command.label;
        if (command.trigger && command.trigger in LIVE_GLYPHS) view.icon = icon(LIVE_GLYPHS[command.trigger as LiveAction]);
      }
    }
  }
  // A setup in flight shows its progress on the control that asked.
  if (state.setupTrigger && !isSeatControl(state.setupTrigger)) {
    const view = buttonFor(state.setupTrigger);
    if (view) view.busy = 'true';
  }

  // ---- Local fixture with preview controls: explicit, confirmed where the car would act, never sent ----
  const pending = state.preview;
  const unknown = state.unknownRevision === m.revision;
  if (enabled) {
    climate.detailHidden = false;
    access.detailHidden = false;
    const open = m.access?.rearTrunk === 'open';
    access.status = `${open ? 'Bagagerum åbent · ' : ''}${m.locked ? 'Låst' : 'Ulåst'}`;
    climateToggle.checked = m.climate.status !== 'off';
    climateToggle.label = climateToggle.checked ? 'Tændt' : 'Slukket';
    temperatureValue = `${String(m.climate.targetTemperatureC)} °C`;
    defrostButton.selected = String(m.climate.defrost);
    const value = m.climate.targetTemperatureC ?? NaN;
    temperatureDown.disabled = !settings || value <= 16;
    temperatureUp.disabled = !settings || value >= 30;
    rearTrunkButton.label = open ? 'Luk bagagerum' : 'Åbn bagagerum';
    defrostButton.label = m.climate.defrost ? 'Stop afrimning' : 'Afrim ruder';
    defrostButton.icon = icon('wind');
    const seats = m.climate.seats ?? {driver: 0, passenger: 0};
    description = `Fører: ${LEVELS[seats.driver] ?? 'Fra'} · Passager: ${LEVELS[seats.passenger] ?? 'Fra'}`;
    if (state.commandResult === 'failed') {
      const failed = buttonFor(state.commandTarget);
      if (failed) failed.state = 'error';
    }
    if (pending && !isSeatControl(pending.trigger)) {
      const view = buttonFor(pending.trigger);
      if (view) {
        view.busy = 'true';
        view.disabled = true;
      }
    }
  }
  // The trunk seen from the side (lærred A-Tesla), open or closed as observed; the action label is kept.
  if (rearTrunkButton.label) rearTrunkButton.icon = icon(trunk === 'open' ? 'car-trunk-open' : 'car-trunk');
  const door = m.locked === true ? 'Låst' : m.locked === false ? 'Ulåst' : 'Ukendt';
  for (const view of [lockButton, liveButtons.lock, liveButtons.unlock]) {
    view.tile = {name: 'Døre', value: door, attention: m.locked === false};
  }
  rearTrunkButton.tile = {
    name: 'Bagagerum',
    value: trunk === 'open' ? 'Åbent' : trunk === 'closed' ? 'Lukket' : 'Ukendt',
    attention: trunk === 'open',
  };

  // ---- Notes ----
  const notes = {
    access: {...state.notes.access, hidden: !state.notes.access.text},
    climate: {...state.notes.climate, hidden: !state.notes.climate.text},
  };
  let secondaryHidden = disconnected;
  if (enabled) {
    access.statusHidden = !notes.access.hidden;
    climate.statusHidden = !notes.climate.hidden;
  } else {
    if (!notes.access.hidden) {
      access.detailHidden = false;
      secondaryHidden = false;
    }
    if (!notes.climate.hidden) {
      climate.detailHidden = false;
      secondaryHidden = false;
    }
  }

  // ---- Dialog ----
  const dialog = state.dialog ?? NO_DIALOG;
  const confirm = button('primary', {
    hidden: !state.dialogOpen,
    label: dialog.confirmLabel,
    icon: dialog.confirmIcon,
    tone: state.dialog ? dialog.confirmTone : undefined,
    // A live confirmation can only be sent while the car is observed and PodVoice is connected.
    disabled: state.proposal
      ? connected === false || m.mode !== 'observed'
      : enabled
        ? !!pending || !controls
        : false,
  });
  const cancel = button('secondary', {
    hidden: !state.dialogOpen,
    label: enabled && pending ? 'Luk' : 'Annuller',
    icon: dialog.cancelIcon,
  });

  return {
    mode: m.mode,
    example: m.mode === 'fixture',
    title: m.title,
    hero: {
      charging,
      kitState: m.mode === 'unconnected' ? 'unavailable' : 'ready',
      message: m.mode === 'unconnected' && !configuredUnavailable,
      carTone,
      carLevel: String(level),
    },
    status: configuredUnavailable ? 'Status ukendt' : trunkOpen ? `${shownStatus} · ${trunkOpen}` : shownStatus,
    connectionNote: {
      text: updated || state.input.connectionDetail || 'Tilføj i Home Assistant',
      hidden: !updated && (m.mode !== 'unconnected' || configuredUnavailable),
    },
    contentHidden: disconnected || (!artwork && measurementsHidden),
    figure: {hidden: !artwork, imageState},
    image: {hidden: !artwork || imageState === 'missing', src: artwork ? VEHICLE_ARTWORK : undefined},
    context: {text: m.context, hidden: !artwork},
    measurementsHidden,
    battery: {
      hidden: m.batteryPercent === null,
      number: m.batteryPercent === null ? '—' : String(m.batteryPercent),
      unit: m.batteryPercent !== null,
    },
    range: {
      hidden: m.rangeKm === null,
      text: m.rangeKm === null ? '—' : `${m.rangeKm.toLocaleString('da-DK', {maximumFractionDigits: 0})} km`,
    },
    cabin: {hidden: !cabin, text: cabin},
    power: {hidden: power === null, text: power ?? ''},
    finish: {hidden: endsAt === null, text: endsAt ?? ''},
    rail: {hidden: !known, known},
    meter: {hidden: !known, value: known ? (m.batteryPercent ?? undefined) : undefined},
    heroIconHidden: artwork && imageState !== 'missing',
    secondaryHidden,
    access,
    climate,
    notes,
    climateBatteryNote: {
      text: batteryNote ? `Lavt batteri (${String(battery)} %) · Tesla afviser måske klima` : '',
      hidden: !batteryNote,
    },
    climateToggle,
    temperatureControlsHidden,
    temperatureValue,
    temperatureDown,
    temperatureUp,
    live: liveButtons,
    lockControlsHidden,
    lockButton,
    rearTrunkButton,
    climateActionsHidden,
    defrostButton,
    seats: {
      hidden: seatsHidden,
      expanded: state.seatExpanded && !disabledSeats,
      disabled: disabledSeats,
      description: state.seatExpanded ? '' : description,
      groups,
    },
    historyHidden: disconnected || !m.history.length,
    timelineHidden: !m.history.length,
    emptyHidden: !!m.history.length,
    dialog,
    dialogOpen: state.dialogOpen,
    confirm,
    cancel,
  };

  function buttonFor(control: Control | null): ButtonView | undefined {
    if (!control || isSeatControl(control)) return undefined;
    const views: Record<ButtonControl, ButtonView> = {
      climateToggle,
      temperatureDown,
      temperatureUp,
      lock: liveButtons.lock,
      unlock: liveButtons.unlock,
      climateOn: liveButtons.climateOn,
      climateOff: liveButtons.climateOff,
      lockButton,
      rearTrunkButton,
      defrostButton,
    };
    return views[control];
  }
}
