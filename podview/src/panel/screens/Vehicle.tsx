// Tesla (the design canvas's A-Tesla, Tesla-Lader/Klima/Parkeret, Tesla-Handling*; DECISIONS §12): the household's
// Tesla from the PodVoice integration (podvoice.vehicle_panel_state; lib/ha/vehicle.ts). The hero (L 458, the lead's
// ruling) is the car as a dot field: the body is the battery, filled to the level and flowing only while it charges;
// the cabin glows orange while the climate heats. Adgang is two K-ActionTiles (Døre, Bagagerum): status and action
// in one surface, whose feedback happens in the surface itself (busy, ✓ for 3 s, unknown). Klima is the switch, the
// −/+ temperature, the seats and »Afrim ruder« as segments. Every control sends podvoice.vehicle_command: the
// integration keeps the add-on's risk model. Lock and, once the climate is on, the reversible, low-risk climate
// controls (off, the temperature, the seats, defrost) go at once (the owner's rulings; −/+ is debounced into one
// command); unlock, the trunk and turning the climate on come back as a confirmation the kit's dialog shows (wake,
// earlier unresolved requests, override) before they are sent once. While the climate is off, what depends on it is
// shown but disabled. The car's own HA entity is the proof; an answer that never came is »Udfald ukendt · kontrollér bilen.«,
// never resent. A field the car has not reported is »Ukendt«, never guessed.
import {useEffect, useId, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {motion} from 'motion/react';
import {useShown} from '../../lib/motion/shown';
import {create, useStore} from 'zustand';
import {useNow} from '../../lib/hooks/clock';
import {updatedLabel, updatedWhen} from '../../lib/format/updated-label';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {useEntities, useLink} from '../../lib/ha/transport';
import {
  CONFIRM_WINDOW_MS, UNKNOWN_OUTCOME, useVehicleCommands, useVehicleConfirm, useVehicleHistory, useVehicleState,
  vehicleConfirms, vehicleWishKey,
} from '../../lib/ha/vehicle';
import type {
  PendingConfirmation, VehicleAction, VehicleArgs, VehicleData, VehicleHistory, VehicleRow,
} from '../../lib/ha/vehicle';
import {
  ActionTile, Button, Dialog, EventRow, Fresh, freshText, Hero, HeroBig, HeroCar, HeroMetrics, Notice, SectionTitle,
  Segment, StatusHero, Stepper, StickyLine, SwitchKey, Widget,
} from '../../ui';
import type {ActionTone, CarTone, GlyphName, ShownNotice, WidgetState} from '../../ui';
import {useNav} from '../nav';
import {useStickyFollow, useStickyHero} from '../sticky';
import {REJECTED_TEXT} from '../ui';

export const SEAT_NAMES: Record<string, string> = {off: 'Fra', low: 'Lav', medium: 'Mellem', high: 'Høj'};
const SEAT_LEVELS = ['off', 'low', 'medium', 'high'] as const;
const PRIOR_NAMES: Record<string, string> = {
  temperature: 'ændre temperaturen',
  defrost: 'betjene afrimningen',
  driverSeat: 'ændre førersædevarmen',
  passengerSeat: 'ændre passagersædevarmen',
  trunk: 'betjene bagagerummet',
};
const UNLOCK_TITLE = 'Lås bilen op?';
const UNLOCK_CONSEQUENCE = 'Bilen låses op. Den låses ikke automatisk igen herfra.';
const REQUESTED = 'Anmodning modtaget.';
const LOW_BATTERY_PERCENT = 15;
const DONE_MS = 3000;
// How long −/+ waits after the last tap before the temperature is sent (one command for a run of taps).
export const TEMPERATURE_SETTLE_MS = 700;
const da = (value: number, digits = 1) => value.toLocaleString('da-DK', {maximumFractionDigits: digits});
const waiting = (wish: Wish | undefined) => wish?.phase === 'sending' || wish?.phase === 'awaiting';

// The old live status line (vehicle-model.js vehicleStatus, ha-home-observation.js vehicleChargeStatus): what the
// charge says, else the lock, then Tesla's own sleep beside it (»Låst · I dvale siden 09.44«); offline is not sleep.
const CHARGE_STATUS: Record<string, string> = {
  charging: 'Lader',
  starting: 'Starter opladning',
  stopped: 'Tilsluttet · lader ikke',
  complete: 'Opladet',
};
export function vehicleStatus(car: VehicleRow, {short = false, now}: {short?: boolean; now: number}): string {
  const data = car.data;
  if (car.status === 'unavailable' || !data) return 'Status ukendt';
  if (car.connection?.state === 'offline') return 'Ikke forbundet';
  const base =
    CHARGE_STATUS[data.charging?.status ?? ''] ??
    (data.locked === true ? 'Låst' : data.locked === false ? 'Ulåst' : 'Status ukendt');
  if (car.connection?.state !== 'asleep') return base;
  const since = car.connection.since;
  const when = typeof since === 'number' ? updatedWhen(since * 1000, new Date(now)) : '';
  return [base, short || !when ? 'I dvale' : `I dvale siden ${when}`].join(' · ');
}

// The hero's line: »Bilen lader« for a charging car, and an open trunk beside it.
export function heroStatus(car: VehicleRow, now: number): string {
  const status = vehicleStatus(car, {now});
  const shown = status === 'Lader' ? 'Bilen lader' : status;
  return car.data?.trunk === 'open' ? `${shown} · Bagagerum åbent` : shown;
}

// When the shown values were last reported by the car: »Opdateret: 17.40« (vehicle-model.js vehicleUpdatedLabel).
export function vehicleUpdated(car: VehicleRow, now: Date): string {
  const at = lastReported(car, now.getTime());
  return at === null ? '' : updatedLabel(at * 1000, now);
}
function lastReported(car: VehicleRow, now: number): number | null {
  const times = [car.observedAt, ...Object.values(car.fieldObservedAt)].filter(
    (at): at is number => typeof at === 'number' && Number.isFinite(at) && at > 0 && at * 1000 <= now + 60_000,
  );
  return times.length ? Math.max(...times) : null;
}

const LIVE_ROLES = ['locked', 'trunk', 'climate', 'defrost', 'driverSeat', 'passengerSeat'] as const;

// HA pushes the car's own entities (lock, cover, climate, switch, select); what they show now replaces the last
// read's value for that field, as the integration's own read does with newer HA changes.
export function withLiveEntities(car: VehicleRow, states: Record<string, HassEntityState | null>): VehicleRow {
  if (!car.data) return car;
  const live = (role: (typeof LIVE_ROLES)[number]) => {
    const id = car.entities[role];
    return id ? (states[id] ?? null) : null;
  };
  const data: VehicleData = {...car.data, climate: {...car.data.climate}};
  const climate = data.climate ?? {};
  const lock = live('locked')?.state;
  if (lock === 'locked' || lock === 'unlocked') data.locked = lock === 'locked';
  const trunk = live('trunk')?.state;
  if (trunk === 'open' || trunk === 'closed') data.trunk = trunk;
  const cabin = live('climate');
  if (cabin?.state === 'off' || cabin?.state === 'heat_cool') climate.status = cabin.state;
  const target = cabin?.attributes.temperature;
  if (typeof target === 'number' && Number.isFinite(target)) climate.targetTemperatureC = target;
  const defrost = live('defrost')?.state;
  if (defrost === 'on' || defrost === 'off') climate.defrost = defrost === 'on';
  for (const [role, field] of [['driverSeat', 'driverSeatHeat'], ['passengerSeat', 'passengerSeatHeat']] as const) {
    const value = live(role)?.state;
    if (value === 'off' || value === 'low' || value === 'medium' || value === 'high') climate[field] = value;
  }
  return {...car, data};
}

function useVehicle() {
  const link = useLink();
  const read = useVehicleState(link.generation);
  const chosen = useVehicleChoice(state => state.deviceId);
  const cars = read.data?.vehicles ?? [];
  const row = cars.find(car => car.deviceId === chosen) ?? cars[0] ?? null;
  const ids = LIVE_ROLES.map(role => row?.entities[role]).filter((id): id is string => !!id);
  const states = useEntities(ids);
  const live = Object.fromEntries(ids.map((id, index) => [id, states[index] ?? null]));
  const car = row ? withLiveEntities(row, live) : null;
  return {link, read, car, cars, live};
}

// The car shown: the one chosen on the screen, else the first (the integration sorts by name).
export const useVehicleChoice = create<{deviceId: string | null}>(() => ({deviceId: null}));

// With more than one car in HA: a segmented choice of the car shown (nothing extra with one).
function VehicleChoice({cars, shown}: {cars: VehicleRow[]; shown: string}) {
  if (cars.length < 2) return null;
  return (
    <Segment aria-label="Tesla" value={shown} options={cars.map(car => ({id: car.deviceId, label: car.name}))}
      onChange={deviceId => {
        useVehicleChoice.setState({deviceId});
      }} />
  );
}

// The Home widget's content (K-Widget tesla, the W-tesla boards), in canvas copy that fits the S widget whole:
// - ikkeforbundet: no known value at all (no data, the integration's row unavailable, or neither a battery level nor
//   a lock or charge state): »Ikke forbundet« · »Kræver tilslutning«, the grey car, no dot;
// - sidstkendt: the values are not current (the integration marks them stale, HA's link is lost, or the car is
//   offline): the last known battery, and under it what is open (with the amber dot), else how old it is in
//   K-Fresh's words (»Opdateret 11.02«, G7 #8, never »Ikke opdateret«), else the lock. After an HA restart while the
//   car sleeps, the integration fills the unknown entities from HA's recorder (vehicle_control.last_known), so the
//   widget shows the last known values here instead of »Status ukendt«;
// - lader, klima, laast: the battery, and under it what is open (with the dot), else the car's own status.
// Without a battery level the status is the primary line. An open car (unlocked, or the trunk open) is an amber dot
// before the words that say so: never a dot without text. '' while the first read runs, and null when HA has no
// Tesla Fleet car or the integration cannot be read: hide the tile then.
export const VEHICLE_OFFLINE = {prim: 'Ikke forbundet', ctx: 'Kræver tilslutning'} as const;

export interface VehicleWidgetContent {
  state: WidgetState<'tesla'>;
  prim: string;
  ctx: string;
  level: number;
  open: boolean;
}

export function vehicleWidgetContent(car: VehicleRow, connected: boolean, now: number): VehicleWidgetContent {
  const data = car.data;
  const battery = typeof data?.batteryPercent === 'number' ? Math.max(0, Math.min(100, data.batteryPercent)) : null;
  const offline = car.connection?.state === 'offline';
  // Offline is said by the state (sidstkendt), not as the status line: the line keeps what the car last said.
  const status = vehicleStatus(offline ? {...car, connection: {state: 'online'}} : car, {short: true, now});
  if (!data || car.status === 'unavailable' || (battery === null && status === 'Status ukendt')) {
    return {state: 'ikkeforbundet', ...VEHICLE_OFFLINE, level: 0, open: false};
  }
  const stale = car.status === 'stale' || !connected || offline;
  const state: WidgetState<'tesla'> = stale ? 'sidstkendt' : data.charging?.status === 'charging' ? 'lader'
    : data.climate?.status === 'heat_cool' ? 'klima' : 'laast';
  const unlocked = data.locked === false;
  const trunk = data.trunk === 'open';
  // The canvas's »Ulåst · bagagerum åbent« is cut in the S widget (172 px, on the canvas too): the unlocked car is
  // said first and alone, an open trunk on its own.
  const openText = unlocked ? 'Ulåst' : trunk ? 'Bagagerum åbent' : '';
  const at = car.status === 'stale' ? lastReported(car, now) : null;
  const fresh = at === null ? '' : freshText(at * 1000, now) ?? '';
  const level = battery === null ? 0 : battery / 100;
  if (battery === null) {
    // The status leads (»Ulåst« says the lock itself); under it an open trunk with the dot, else how old it is.
    return {state, prim: status, ctx: trunk ? 'Bagagerum åbent' : fresh, level, open: trunk};
  }
  const ctx = openText || (stale ? fresh || status : status);
  return {state, prim: `${String(Math.round(battery))} %`, ctx, level, open: !!openText};
}

export function useVehicleWidget() {
  const {link, read, car} = useVehicle();
  const now = useNow();
  if (!car) return read.isPending && link.connected ? {state: 'ikkeforbundet' as const, prim: '', ctx: '', level: 0,
    open: false} : null;
  return vehicleWidgetContent(car, link.connected, now);
}

export function VehicleTile() {
  const widget = useVehicleWidget();
  const push = useNav(state => state.push);
  if (widget === null) return null;
  return (
    <Widget
      id="home-vehicle"
      kind="tesla"
      state={widget.state}
      opens="vehicle"
      prim={widget.prim}
      ctx={widget.ctx}
      level={widget.level}
      {...(widget.open && widget.ctx ? {alert: 'warning' as const} : {})}
      onPress={() => {
        push('vehicle');
      }}
    />
  );
}

export interface ConfirmContent {
  title: string;
  description: string;
  cancelLabel: string;
  acceptLabel: string;
  acceptDisabled: boolean;
}

// The dialog's words for the integration's confirmation (the old screen's propose()).
export function confirmContent(pending: PendingConfirmation, connected: boolean, observed: boolean): ConfirmContent {
  const c = pending.confirmation;
  const unlocking = c.action === 'unlock';
  const args = pending.args;
  const requested =
    c.action === 'temperature'
      ? `${c.label}: ${String(args.temperature).replace('.', ',')} °C`
      : ['driverSeatHeat', 'passengerSeatHeat'].includes(c.action)
        ? `${c.label}: ${SEAT_NAMES[String(args.option)] ?? ''}`
        : c.label;
  const unresolved = c.priorUnresolved;
  const prior = [
    ...Object.entries(unresolved)
      .filter(([key, values]) => !['access', 'climate'].includes(key) && values.length)
      .map(([key]) => PRIOR_NAMES[key])
      .filter((name): name is string => !!name),
    ...(unresolved.access ?? []).map(value => (value === 'locked' ? 'låse bilen' : 'låse bilen op')),
    ...(unresolved.climate ?? []).map(value => (value === 'on' ? 'tænde klimaet' : 'slukke klimaet')),
  ];
  const priorText = prior.length > 1 ? `${prior.slice(0, -1).join(', ')} og ${prior.at(-1) ?? ''}` : prior[0];
  const effect = (value: string) => c.effects.some(([family, v]) => family === 'climate' && v === value);
  const description = [
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
  return {
    title: unlocking ? UNLOCK_TITLE : `${requested}?`,
    description,
    cancelLabel: 'Annuller',
    acceptLabel: c.label,
    // A live confirmation can only be sent while the car is observed and HA is connected.
    acceptDisabled: !connected || !observed,
  };
}

function useFamilyWish(car: VehicleRow, action: VehicleAction) {
  return useStore(commands.store, state => state.wishes[vehicleWishKey(car.deviceId, action)]);
}

function familyNotice(wish: Wish | undefined): ShownNotice | null {
  if (!wish) return null;
  const id = `${wish.key}:${String(wish.seq)}`;
  if (wish.phase === 'unknown') {
    return {id, level: 'fejl', title: UNKNOWN_OUTCOME, ...(wish.reason && wish.reason !== 'timeout'
      ? {text: wish.reason} : {text: 'Svar mangler · Kontrollér bilen før en ny kommando.'})};
  }
  if (wish.phase === 'rejected') {
    return {id, level: 'fejl', title: wish.reason && wish.reason !== 'rejected' ? wish.reason : REJECTED_TEXT};
  }
  if (wish.phase === 'not_sent') return {id, level: 'info', title: 'Ikke sendt – ingen forbindelse'};
  return null;
}

// The action a family's wish carries while it waits, and a short ✓ once the car shows it (Tesla-Handling: the
// confirmed surface pops green for 3 s). A confirmation step (nothing sent yet) ends the wish without an effect.
function useFeedback(car: VehicleRow, family: VehicleAction, live: Record<string, HassEntityState | null>,
  role: string) {
  const wish = useFamilyWish(car, family);
  const sending = waiting(wish) ? (wish?.value as {action: VehicleAction; args: VehicleArgs}) : null;
  const last = useRef<{action: VehicleAction; args: VehicleArgs} | null>(null);
  const [done, setDone] = useState<VehicleAction | null>(null);
  const id = car.entities[role];
  const entity = id ? (live[id] ?? null) : null;
  useEffect(() => {
    if (sending) {
      last.current = sending;
      return;
    }
    const was = last.current;
    last.current = null;
    if (!was || wish) return;
    if (!vehicleConfirms(was.action, was.args)(entity)) return;
    setDone(was.action);
    const handle = setTimeout(() => {
      setDone(null);
    }, DONE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [sending, wish, entity]);
  return {wish, sending: sending?.action ?? null, done};
}

// ---- Adgang ------------------------------------------------------------------------------------------------------

function DoorTile({car, connected, live}: {car: VehicleRow; connected: boolean;
  live: Record<string, HassEntityState | null>}) {
  const send = useVehicleCommands();
  const {wish, sending, done} = useFeedback(car, 'lock', live, 'locked');
  const locked = car.data?.locked;
  const can = (action: VehicleAction) => car.controls.includes(action);
  let tone: ActionTone = locked === false ? 'attention' : 'calm';
  let value = locked === true ? 'Låst' : locked === false ? 'Ulåst' : 'Ukendt';
  let hint = locked === true ? (can('unlock') ? 'Tryk for at låse op' : '')
    : locked === false ? (can('lock') ? 'Tryk for at låse' : '') : 'Status ukendt';
  let icon: GlyphName = locked === false ? 'unlock' : 'lock';
  if (sending) {
    tone = 'busy';
    value = sending === 'unlock' ? 'Låser op…' : 'Låser…';
    hint = REQUESTED;
    icon = sending === 'unlock' ? 'unlock' : 'lock';
  } else if (wish?.phase === 'unknown') {
    tone = 'error';
    value = 'Ukendt';
    hint = 'Kontrollér bilen.';
  } else if (done) {
    tone = 'done';
    value = done === 'unlock' ? 'Ulåst' : 'Låst';
    hint = 'Bekræftet';
  }
  const action: VehicleAction | null = locked === true && can('unlock') ? 'unlock'
    : locked === false && can('lock') ? 'lock' : null;
  return (
    <ActionTile label="Døre" value={value} hint={hint} icon={icon} tone={tone} height={196}
      data-vehicle-action={action ?? undefined}
      isDisabled={!action || !connected || car.status === 'unavailable'}
      onPress={() => {
        // Locking is safe and goes at once; unlocking comes back as the integration's confirmation (the dialog).
        if (action) send({car, action});
      }} />
  );
}

function TrunkTile({car, connected, live}: {car: VehicleRow; connected: boolean;
  live: Record<string, HassEntityState | null>}) {
  const send = useVehicleCommands();
  const {wish, sending, done} = useFeedback(car, 'rearTrunkToggle', live, 'trunk');
  const trunk = car.data?.trunk;
  const can = car.controls.includes('rearTrunkToggle') && !!trunk;
  let tone: ActionTone = trunk === 'open' ? 'attention' : 'calm';
  let value = trunk === 'open' ? 'Åbent' : trunk === 'closed' ? 'Lukket' : 'Ukendt';
  let hint = !can ? (trunk ? '' : 'Status ukendt') : trunk === 'open' ? 'Tryk for at lukke' : 'Tryk for at åbne';
  if (sending) {
    tone = 'busy';
    value = 'Bagagerum…';
    hint = REQUESTED;
  } else if (wish?.phase === 'unknown') {
    tone = 'error';
    value = 'Ukendt';
    hint = 'Kontrollér bilen.';
  } else if (done) {
    tone = 'done';
    value = trunk === 'open' ? 'Åbent' : 'Lukket';
    hint = 'Bekræftet';
  }
  return (
    <ActionTile label="Bagagerum" value={value} hint={hint} icon={trunk === 'open' ? 'trunkOpen' : 'trunk'} tone={tone}
      height={196} data-vehicle-action={can ? 'rearTrunkToggle' : undefined}
      isDisabled={!can || !connected || car.status === 'unavailable'}
      onPress={() => {
        send({car, action: 'rearTrunkToggle', args: {direction: trunk === 'closed' ? 'open' : 'close'}});
      }} />
  );
}

function Access({car, connected, live}: {car: VehicleRow; connected: boolean;
  live: Record<string, HassEntityState | null>}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge"
      aria-labelledby="vehicle-access-title">
      <div className="flex h-11 items-center">
        <SectionTitle id="vehicle-access-title">Adgang</SectionTitle>
      </div>
      <div className="grid flex-1 grid-cols-2 items-stretch gap-3">
        <DoorTile car={car} connected={connected} live={live} />
        {car.entities.trunk ? <TrunkTile car={car} connected={connected} live={live} /> : null}
      </div>
    </section>
  );
}

// ---- Klima -------------------------------------------------------------------------------------------------------

function ClimateRow({label, labelId, children}: {label: string; labelId: string;
  children: ReactNode}) {
  return (
    <div className="grid grid-cols-[74px_minmax(0,1fr)] items-center gap-1.5 border-t border-pv-ink/7 py-2">
      <span id={labelId} className="text-[15px] font-semibold text-pv-ink-2">{label}</span>
      {children}
    </div>
  );
}

function Climate({car, connected}: {car: VehicleRow; connected: boolean}) {
  const send = useVehicleCommands();
  const climate = car.data?.climate ?? {};
  const wish = useFamilyWish(car, 'climateOn');
  const can = (action: VehicleAction) => car.controls.includes(action);
  const on = climate.status === 'heat_cool';
  const enabled = connected && car.status !== 'unavailable';
  const range = car.temperatureRange;
  const target = climate.targetTemperatureC;
  const driverId = useId();
  const passengerId = useId();
  const defrostId = useId();
  const pendingAction = waiting(wish) ? (wish?.value as {action?: VehicleAction} | undefined)?.action : undefined;
  const pendingArgs = waiting(wish) ? (wish?.value as {args?: VehicleArgs}).args : undefined;
  // −/+ is reversible and low-risk (the owner's ruling): no confirmation, and a run of taps is one command. Each tap
  // moves the shown target at once (the draft); TEMPERATURE_SETTLE_MS after the last tap the draft is sent once.
  // Leaving the screen sends a waiting draft at once.
  const [draft, setDraft] = useState<number | null>(null);
  const flush = useRef<(() => void) | null>(null);
  const latest = useRef({car, send});
  useEffect(() => {
    latest.current = {car, send};
  });
  useEffect(() => () => {
    flush.current?.();
  }, []);
  useEffect(() => {
    if (draft === null) return;
    const deliver = () => {
      flush.current = null;
      latest.current.send({car: latest.current.car, action: 'temperature', args: {temperature: draft}});
      setDraft(null);
    };
    flush.current = deliver;
    const timer = setTimeout(deliver, TEMPERATURE_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);
  const wished = pendingAction === 'temperature' ? (pendingArgs?.temperature ?? target) : target;
  const shownTarget = draft ?? wished;
  const step = (delta: number) => {
    if (typeof shownTarget !== 'number' || !range) return;
    const value = shownTarget + delta * 0.5;
    if (value < range.min || value > range.max) return;
    setDraft(value);
  };
  const battery = car.data?.batteryPercent;
  const low = car.status === 'observed' && typeof battery === 'number' && battery < LOW_BATTERY_PERCENT;
  const switching = pendingAction === 'climateOn' || pendingAction === 'climateOff';
  const label = switching ? (pendingAction === 'climateOn' ? 'Tænder…' : 'Slukker…')
    : on ? `Tændt${typeof target === 'number' ? ` · ${da(target)} °C` : ''}`
      : climate.status === 'off' ? 'Slukket' : 'Ukendt';
  const notice = familyNotice(wish);
  // Temperature, seats and defrost need the climate on (the integration refuses them otherwise).
  const dependent = enabled && on;
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge"
      aria-labelledby="vehicle-climate-title">
      <div className="mb-2 flex h-11 items-center justify-between">
        <span className="flex flex-col">
          <SectionTitle id="vehicle-climate-title" className="leading-7">Klima</SectionTitle>
          <span className="text-[15px] leading-[18px] text-pv-ink-3" aria-live="polite">{label}</span>
        </span>
        {can('climateOn') && climate.status ? (
          <SwitchKey aria-label="Klima" isSelected={switching ? pendingAction === 'climateOn' : on}
            isDisabled={!enabled}
            onChange={() => {
              send({car, action: on ? 'climateOff' : 'climateOn'});
            }} />
        ) : null}
      </div>
      {can('temperature') && range ? (
        <div className="flex items-center justify-between border-t border-pv-ink/7 py-2">
          <span className="text-[15px] font-semibold text-pv-ink-2">Temperatur</span>
          <Stepper value={typeof shownTarget === 'number' ? `${da(shownTarget)}°` : '—'} muted={!on}
            isPending={draft !== null || pendingAction === 'temperature'}
            decrementLabel="Sænk temperatur" incrementLabel="Hæv temperatur"
            canDecrement={dependent && typeof shownTarget === 'number' && shownTarget - 0.5 >= range.min}
            canIncrement={dependent && typeof shownTarget === 'number' && shownTarget + 0.5 <= range.max}
            onDecrement={() => {
              step(-1);
            }}
            onIncrement={() => {
              step(1);
            }} />
        </div>
      ) : null}
      {(['driver', 'passenger'] as const).map(seat => {
        const action = seat === 'driver' ? 'driverSeatHeat' : 'passengerSeatHeat';
        const value = seat === 'driver' ? climate.driverSeatHeat : climate.passengerSeatHeat;
        if (!can(action)) return null;
        const wished = pendingAction === action ? pendingArgs?.option : undefined;
        const labelId = seat === 'driver' ? driverId : passengerId;
        return (
          <ClimateRow key={seat} label={seat === 'driver' ? 'Førersæde' : 'Passager'} labelId={labelId}>
            <Segment aria-labelledby={labelId} fill dense isDisabled={!dependent} value={wished ?? value ?? null}
              options={SEAT_LEVELS.map(level => ({id: level, label: SEAT_NAMES[level] ?? level}))}
              // »Mellem« is the long word: it gets the room it needs, the short ones give it (never »Mell…«).
              weights={SEAT_LEVELS.map(level => (SEAT_NAMES[level] ?? level).length > 4 ? 1.4 : 0.87)}
              data-busy={wished}
              onChange={level => {
                send({car, action, args: {option: level}});
              }} />
          </ClimateRow>
        );
      })}
      {can('defrostOn') ? (
        <ClimateRow label="Afrim ruder" labelId={defrostId}>
          <Segment aria-labelledby={defrostId} fill dense isDisabled={!dependent}
            value={pendingAction === 'defrostOn' ? 'on' : pendingAction === 'defrostOff' ? 'off'
              : typeof climate.defrost === 'boolean' ? (climate.defrost ? 'on' : 'off') : null}
            options={[{id: 'off', label: 'Fra'}, {id: 'on', label: 'Til'}]}
            onChange={next => {
              send({car, action: next === 'on' ? 'defrostOn' : 'defrostOff'});
            }} />
        </ClimateRow>
      ) : null}
      {low && can('climateOn') && !on ? (
        <p className="m-0 text-[15px] text-pv-ink-3">
          {`Lavt batteri (${String(Math.round(battery))} %) · Tesla afviser måske klima`}
        </p>
      ) : null}
      {notice ? <Notice compact level={notice.level} title={notice.title} className="self-start" /> : null}
    </section>
  );
}

// ---- The confirmation the integration asks for -------------------------------------------------------------------

function Confirmation({car, connected}: {car: VehicleRow | null; connected: boolean}) {
  const pending = useVehicleConfirm(state => state.pending);
  const send = useVehicleCommands();
  const close = () => {
    useVehicleConfirm.setState({pending: null});
  };
  // The integration's confirmation expires after 15 s: the dialog closes before that, and a new tap asks again.
  useEffect(() => {
    if (!pending) return;
    const left = CONFIRM_WINDOW_MS - (globalThis.performance.now() - pending.receivedAt);
    const timer = setTimeout(() => {
      if (useVehicleConfirm.getState().pending === pending) useVehicleConfirm.setState({pending: null});
    }, Math.max(0, left));
    return () => {
      clearTimeout(timer);
    };
  }, [pending]);
  const shown = pending && pending.deviceId === car?.deviceId ? pending : null;
  const content = shown ? confirmContent(shown, connected, car?.status === 'observed') : null;
  // Closed, the dialog keeps its last words while it fades out (AnimatePresence holds the leaving element).
  const words = content;
  return (
    <Dialog isOpen={content !== null} title={words?.title ?? ''} description={words?.description ?? ''}
      cancelLabel={words?.cancelLabel ?? 'Annuller'} confirmLabel={words?.acceptLabel ?? ''}
      confirmDisabled={words?.acceptDisabled ?? true}
      onCancel={close}
      onConfirm={() => {
        if (!shown || !car) return;
        close();
        send({car, action: shown.action, args: shown.args, confirmation: shown.confirmation});
      }} />
  );
}

// ---- Seneste hændelser -------------------------------------------------------------------------------------------

const EVENT_TEXT: Record<string, Record<string, string>> = {
  locked: {locked: 'Låst', unlocked: 'Ulåst'},
  trunk: {open: 'Bagagerum · Åbent', closed: 'Bagagerum · Lukket'},
  climate: {off: 'Klima · Slukket', heat_cool: 'Klima · Varme/køling'},
  charging: CHARGE_STATUS,
};
export const eventText = (field: string, value: string) => EVENT_TEXT[field]?.[value] ?? '';

function History({history}: {history: VehicleHistory | undefined}) {
  if (history?.status !== 'observed') return null;
  const rows = history.items
    .map(item => ({...item, text: eventText(item.field, item.value)}))
    .filter(item => item.text);
  return (
    <section className="flex flex-col gap-3.5 rounded-pv-widget bg-pv-surface p-6 shadow-pv-edge"
      aria-labelledby="vehicle-history-title">
      <SectionTitle id="vehicle-history-title">Seneste hændelser</SectionTitle>
      {rows.length ? rows.map(item => (
        <EventRow key={`${item.field}-${String(item.at)}`} time={updatedWhen(item.at * 1000)} title={item.text} />
      )) : <p className="m-0 text-[15px] text-pv-ink-3">Ingen hændelser at vise endnu.</p>}
    </section>
  );
}

// ---- The hero ----------------------------------------------------------------------------------------------------

type Look = 'lader' | 'klima' | 'parkeret' | 'ukendt';

function carLook(car: VehicleRow, connected: boolean): Look {
  const data = car.data;
  if (!data || car.status !== 'observed' || !connected || car.connection?.state === 'offline') return 'ukendt';
  if (data.charging?.status === 'charging') return 'lader';
  if (data.climate?.status === 'heat_cool') return 'klima';
  return 'parkeret';
}

const TONE: Record<Look, CarTone> = {lader: 'charging', klima: 'climate', parkeret: 'parked', ukendt: 'unknown'};

// The hero (A-Tesla): the eyebrow is the charge cable, the title what the car is doing, the line under it the range
// (and the cabin); the battery in mono at the top right; the metrics at its foot only what is relevant to the state.
function Hero458({car, connected, notice, heroRef}: {car: VehicleRow; connected: boolean;
  notice: ShownNotice | null; heroRef: (node: HTMLElement | null) => void}) {
  const now = useNow();
  const data = car.data ?? {};
  const look = carLook(car, connected);
  const battery = typeof data.batteryPercent === 'number' ? Math.max(0, Math.min(100, data.batteryPercent)) : null;
  const climate = data.climate ?? {};
  const plug = data.charging?.status;
  const eyebrow = look === 'ukendt' ? (car.modelName ?? car.name)
    : plug === 'disconnected' ? 'Ikke tilsluttet' : plug ? 'Tilsluttet' : (car.modelName ?? car.name);
  const range = typeof data.rangeKm === 'number' ? `${da(data.rangeKm, 0)} km rækkevidde` : '';
  const cabin = typeof climate.temperatureC === 'number' ? `kabine ${da(climate.temperatureC)}°` : '';
  const asleep = car.connection?.state === 'asleep' ? vehicleStatus(car, {now}).split(' · ').slice(1).join(' · ') : '';
  const lock = data.locked === true ? 'Låst' : data.locked === false ? 'Ulåst' : 'Status ukendt';
  const title = look === 'lader' ? 'Lader' : look === 'klima' ? 'Klimaet kører' : look === 'parkeret' ? 'Parkeret'
    // Last known (sidstkendt): the lock the car last reported, with K-Fresh's age in the corner; »Ikke forbundet«
    // only for an offline car with no known lock.
    : car.connection?.state === 'offline' && data.locked === undefined ? 'Ikke forbundet' : lock;
  const sub = look === 'klima' && typeof climate.targetTemperatureC === 'number'
    ? `Varmer kabinen til ${da(climate.targetTemperatureC)} °C`
    : [range, look === 'ukendt' ? cabin : asleep].filter(Boolean).join(' · ');
  const at = lastReported(car, now);
  const fresh = at === null ? null : freshText(at * 1000, now);
  const power = typeof data.charging?.powerKw === 'number' ? `${da(data.charging.powerKw)} kW` : null;
  const ends = typeof data.charging?.endsAt === 'number'
    ? new Date(data.charging.endsAt * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'}) : null;
  const metrics = look === 'lader' ? [...(power ? [{value: power, label: 'ladeeffekt'}] : []),
    ...(ends ? [{value: ends, label: 'forventet færdig'}] : [])]
    : look === 'parkeret' || (look === 'ukendt' && (data.locked !== undefined || climate.status !== undefined))
      ? [{value: lock === 'Status ukendt' ? 'Ukendt' : lock, label: 'adgang'},
        {value: climate.status === 'off' ? 'Slukket' : climate.status === 'heat_cool' ? 'Tændt' : 'Ukendt',
          label: 'klima'}]
      : look === 'klima' ? [...(typeof climate.temperatureC === 'number'
        ? [{value: `${da(climate.temperatureC)} °C`, label: 'inde nu'}] : []),
      ...(typeof climate.targetTemperatureC === 'number'
        ? [{value: `${da(climate.targetTemperatureC)} °C`, label: 'mål'}] : []),
      ...(climate.driverSeatHeat && climate.driverSeatHeat !== 'off'
        ? [{value: SEAT_NAMES[climate.driverSeatHeat] ?? '', label: 'førersæde'}] : [])]
        : [];
  const shownNotice = notice ?? (data.trunk === 'open'
    ? {id: 'trunk-open', level: 'handling' as const, title: 'Bagagerum åbent'} : null);
  return (
    <StatusHero ref={heroRef} variant="tesla" size="L" surface={look === 'lader' || look === 'klima' ? 'teslaLive'
      : 'tesla'} aria-label="Bilens status" data-car-tone={TONE[look]}
      data-car-level={String(battery === null ? 0 : battery / 100)}
      // A-Tesla: the metrics stand at the hero's foot on the left and the car beside them, never under it; in the
      // L hero the car rides on the metrics' line (its foot 64 px up) when there are metrics.
      art={<HeroCar level={battery === null ? 0 : battery / 100} tone={TONE[look]} warm={look === 'klima'}
        {...(metrics.length ? {className: 'bottom-16'} : {})} />}
      eyebrow={eyebrow}
      corner={fresh ? <Fresh text={fresh} /> : eyebrow === car.modelName || !car.modelName ? null
        : <span className="text-[15px] font-semibold text-pv-ink-3">{car.modelName}</span>}
      // Black text everywhere (G7 ruling): the live states are carried by the surface and the car, not green ink.
      title={title} titleTone={look === 'ukendt' ? 'muted' : 'ink'} sub={sub}
      notice={shownNotice}
      big={battery === null ? null : <HeroBig value={String(Math.round(battery))}
        tone={look === 'ukendt' ? 'muted' : 'ink'} />}
      footer={<HeroMetrics items={metrics} />} />
  );
}

function CarView({car, cars, connected, live}: {car: VehicleRow; cars: VehicleRow[]; connected: boolean;
  live: Record<string, HassEntityState | null>}) {
  const link = useLink();
  const history = useVehicleHistory(car.deviceId, link.generation);
  const lockWish = useFamilyWish(car, 'lock');
  const trunkWish = useFamilyWish(car, 'rearTrunkToggle');
  const send = useVehicleCommands();
  const follow = useStickyFollow();
  const shown = useShown();
  const {heroRef, past, main} = useStickyHero();
  const now = useNow();
  const notice = familyNotice(lockWish) ?? familyNotice(trunkWish);
  const look = carLook(car, connected);
  const locked = car.data?.locked;
  const door: VehicleAction | null = locked === true && car.controls.includes('unlock') ? 'unlock'
    : locked === false && car.controls.includes('lock') ? 'lock' : null;
  return (
    <>
      <VehicleChoice cars={cars} shown={car.deviceId} />
      <Hero458 car={car} connected={connected} notice={notice} heroRef={heroRef} />
      <div className="grid min-h-[308px] grid-cols-2 gap-4" aria-label="Adgang og klima" role="group">
        <Access car={car} connected={connected} live={live} />
        {car.entities.climate ? <Climate car={car} connected={connected} /> : null}
      </div>
      <History history={history.data} />
      <Confirmation car={car} connected={connected} />
      {main ? createPortal(
        <motion.div style={follow} className="pointer-events-none absolute top-0 left-0 z-[3] w-[736px]">
          <StickyLine isShown={past && shown} surface="tesla" label="Tesla, handlinger" className="pointer-events-auto"
            dot={look === 'ukendt' ? 'grey' : 'ok'} title={heroStatus(car, now)}
            sub={[typeof car.data?.batteryPercent === 'number' ? `${String(Math.round(car.data.batteryPercent))} %`
              : '', typeof car.data?.rangeKm === 'number' ? `${da(car.data.rangeKm, 0)} km` : '']
              .filter(Boolean).join(' · ')}
            primary={door ? (
              <Button variant="primaer" size={44} busy={waiting(lockWish)} isDisabled={!connected}
                onPress={() => {
                  send({car, action: door});
                }}>
                {door === 'unlock' ? 'Lås op' : 'Lås bilen'}
              </Button>
            ) : null} />
        </motion.div>, main) : null}
    </>
  );
}

export function VehicleScreen() {
  const {link, read, car, cars, live} = useVehicle();
  if (!car) {
    const loading = read.isPending && link.connected;
    return (
      <section id="vehicle-view" className="flex flex-col gap-4 pb-6" aria-labelledby="vehicle-title">
        <h1 id="vehicle-title" className="sr-only">Tesla</h1>
        {loading ? (
          <p className="m-0 px-1 text-[15px] text-pv-ink-3" role="status">afventer svar…</p>
        ) : (
          <Hero tone="tesla" eyebrow="Tesla" title={read.isError ? 'Status ukendt' : 'Ikke forbundet'}
            text={read.isError ? 'Status kunne ikke hentes' : 'Forbind bilen i Home Assistant for at se status her.'} />
        )}
      </section>
    );
  }
  return (
    <section id="vehicle-view" className="flex flex-col gap-4 pb-6" aria-labelledby="vehicle-title"
      data-vehicle-mode="observed">
      <h1 id="vehicle-title" className="sr-only">Tesla</h1>
      <CarView car={car} cars={cars} connected={link.connected} live={live} />
    </section>
  );
}
