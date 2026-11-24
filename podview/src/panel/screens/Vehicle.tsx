// Bil on HA: the household's Tesla from the PodVoice integration (podvoice.vehicle_panel_state; lib/ha/vehicle.ts).
// What the car last reported is shown with the old Bil screen's words (status line, Døre, Bagagerum, Klima, seats);
// a field the car has not reported is »Ukendt«, never guessed. Every control sends podvoice.vehicle_command: the
// integration keeps the add-on's risk model, so lock goes at once and everything else comes back as a confirmation
// that the dialog shows (wake, earlier unresolved requests, override) before it is sent once. The car's own HA entity
// is the proof; an answer that never came is »Udfald ukendt · kontrollér bilen.«, never resent.
import {useEffect} from 'react';
import {useNow} from '../../lib/hooks/clock';
import type {CSSProperties} from 'react';
import {create, useStore} from 'zustand';
import {updatedLabel, updatedWhen} from '../../lib/format/updated-label';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {useEntities, useLink} from '../../lib/ha/transport';
import {
  CONFIRM_WINDOW_MS,
  localLockConfirmation,
  lockNeedsLocalStep,
  UNKNOWN_OUTCOME,
  useVehicleCommands,
  useVehicleConfirm,
  useVehicleHistory,
  useVehicleState,
  vehicleWishKey,
} from '../../lib/ha/vehicle';
import type {
  PendingConfirmation,
  VehicleAction,
  VehicleArgs,
  VehicleData,
  VehicleHistory,
  VehicleRow,
} from '../../lib/ha/vehicle';
import {KitButton} from '../../lib/ui/KitButton';
import {useNav} from '../nav';
import {BUTTON, icon, Notice, REJECTED_TEXT, Shortcut} from '../ui';
import {ConfirmOverlay} from './robot-confirm';
import type {ConfirmContent} from './robot-confirm';

export const SEAT_NAMES: Record<string, string> = {off: 'Fra', low: 'Lav', medium: 'Mellem', high: 'Høj'};
const SEAT_LEVELS = ['off', 'low', 'medium', 'high'] as const;
const CLIMATE_NAMES: Record<string, string> = {off: 'Slukket', heat_cool: 'Varme/køling'};
const PRIOR_NAMES: Record<string, string> = {
  temperature: 'ændre temperaturen',
  defrost: 'betjene afrimningen',
  driverSeat: 'ændre førersædevarmen',
  passengerSeat: 'ændre passagersædevarmen',
  trunk: 'betjene bagagerummet',
};
const UNLOCK_TITLE = 'Lås bilen op?';
const UNLOCK_CONSEQUENCE = 'Bilen låses op. Den låses ikke automatisk igen herfra.';
// The progress label of a command while it waits for the car.
const PROGRESS: Record<VehicleAction, string> = {
  lock: 'Låser…',
  unlock: 'Låser op…',
  climateOn: 'Tænder…',
  climateOff: 'Slukker…',
  temperature: 'Ændrer temperatur…',
  defrostOn: 'Afrimer…',
  defrostOff: 'Stopper afrimning…',
  driverSeatHeat: 'Ændrer sædevarme…',
  passengerSeatHeat: 'Ændrer sædevarme…',
  rearTrunkToggle: 'Bagagerum…',
};
const LOW_BATTERY_PERCENT = 15;
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
  const times = [car.observedAt, ...Object.values(car.fieldObservedAt)].filter(
    (at): at is number =>
      typeof at === 'number' && Number.isFinite(at) && at > 0 && at * 1000 <= now.getTime() + 60_000,
  );
  return times.length ? updatedLabel(Math.max(...times) * 1000, now) : '';
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
  return {link, read, car, cars};
}

// The car shown: the one chosen on the screen, else the first (the integration sorts by name).
export const useVehicleChoice = create<{deviceId: string | null}>(() => ({deviceId: null}));

// With more than one car in HA: a segmented choice of the car shown (nothing extra with one).
function VehicleChoice({cars, shown}: {cars: VehicleRow[]; shown: string}) {
  if (cars.length < 2) return null;
  return (
    <div className="pv-panel-choice" role="radiogroup" aria-label="Tesla">
      {cars.map(car => (
        <KitButton
          key={car.deviceId}
          className="pv-kit pv-kit-chip pv-chip"
          data-kit="chip"
          role="radio"
          aria-checked={car.deviceId === shown}
          onPress={() => {
            useVehicleChoice.setState({deviceId: car.deviceId});
          }}
        >
          {car.name}
        </KitButton>
      ))}
    </div>
  );
}

// The Home tile's line: the car's status with its battery, '' while the first read runs, and null when HA has no
// Tesla Fleet car or the integration cannot be read: hide the tile then.
export function useVehicleLine(): string | null {
  const {link, read, car} = useVehicle();
  const now = useNow();
  if (!car) return read.isPending && link.connected ? '' : null;
  const battery = car.data?.batteryPercent;
  return [
    `${car.status === 'stale' ? 'Ikke opdateret · ' : ''}${vehicleStatus(car, {short: true, now})}`,
    typeof battery === 'number' ? `${String(Math.round(battery))} %` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function VehicleTile() {
  const line = useVehicleLine();
  const push = useNav(state => state.push);
  if (line === null) return null;
  return (
    <Shortcut
      id="home-vehicle"
      screen="vehicle"
      iconName="car-front"
      title="Tesla"
      detail={line}
      onPress={() => {
        push('vehicle');
      }}
    />
  );
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
    id: `vehicle-confirm-${c.token}`,
    title: unlocking ? UNLOCK_TITLE : `${requested}?`,
    description,
    cancelLabel: 'Annuller',
    acceptLabel: c.label,
    ...(unlocking ? {tone: 'danger' as const} : {}),
    // A live confirmation can only be sent while the car is observed and HA is connected.
    acceptDisabled: !connected || !observed,
  };
}

function useFamilyWish(car: VehicleRow, action: VehicleAction) {
  return useStore(commands.store, state => state.wishes[vehicleWishKey(car.deviceId, action)]);
}

function familyNotice(wish: Wish | undefined): string {
  if (wish?.phase === 'unknown')
    return wish.reason && wish.reason !== 'timeout' ? `${UNKNOWN_OUTCOME} ${wish.reason}` : UNKNOWN_OUTCOME;
  if (wish?.phase === 'rejected') return wish.reason && wish.reason !== 'rejected' ? wish.reason : REJECTED_TEXT;
  return '';
}

interface ActionButtonProps {
  car: VehicleRow;
  action: VehicleAction;
  label: string;
  iconName: string;
  args?: VehicleArgs;
  connected: boolean;
  variant?: 'primary';
}

function ActionButton({car, action, label, iconName, args, connected, variant}: ActionButtonProps) {
  const send = useVehicleCommands();
  const wish = useFamilyWish(car, action);
  const mine = waiting(wish) && (wish?.value as {action?: string} | undefined)?.action === action;
  return (
    <KitButton
      className={BUTTON}
      data-kit="button"
      data-kit-variant={variant}
      data-vehicle-action={action}
      aria-busy={mine ? true : undefined}
      isDisabled={!connected || car.status === 'unavailable'}
      onPress={() => {
        // Lock can wake the car: the old screen asked first (lib/ha/vehicle.ts lockNeedsLocalStep).
        if (action === 'lock' && lockNeedsLocalStep(car)) {
          useVehicleConfirm.setState({pending: localLockConfirmation(car.deviceId)});
          return;
        }
        send({car, action, ...(args ? {args} : {})});
      }}
    >
      <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon(iconName)} alt="" />
      <span>{mine ? PROGRESS[action] : label}</span>
    </KitButton>
  );
}

function Access({car, connected}: {car: VehicleRow; connected: boolean}) {
  const data = car.data ?? {};
  const lockWish = useFamilyWish(car, 'lock');
  const trunkWish = useFamilyWish(car, 'rearTrunkToggle');
  const can = (action: VehicleAction) => car.controls.includes(action);
  const door = data.locked === true ? 'Låst' : data.locked === false ? 'Ulåst' : 'Ukendt';
  const trunk = data.trunk === 'open' ? 'Åbent' : data.trunk === 'closed' ? 'Lukket' : 'Ukendt';
  return (
    <section
      className="device-history vehicle-disclosure pv-tile pv-kit pv-kit-tile"
      data-kit="tile"
      data-kit-identity="tesla" data-vehicle-section="access"
      aria-labelledby="vehicle-access-title"
    >
      <h2 id="vehicle-access-title" className="vehicle-section-heading pv-section-header">
        <span data-kit-text="section-title">Adgang</span>
      </h2>
      <div className="pv-kit pv-kit-listrow pv-row" data-kit="listrow" data-attention={String(data.locked === false)}>
        <span>Døre</span>
        <strong>{door}</strong>
        {can('lock') && data.locked !== true ? (
          <ActionButton car={car} action="lock" label="Lås bilen" iconName="lock" connected={connected} />
        ) : null}
        {can('unlock') && data.locked !== false ? (
          <ActionButton car={car} action="unlock" label="Lås op" iconName="lock-open" connected={connected} />
        ) : null}
      </div>
      <Notice text={familyNotice(lockWish)} />
      {car.entities.trunk ? (
        <div className="pv-kit pv-kit-listrow pv-row" data-kit="listrow" data-attention={String(data.trunk === 'open')}>
          <span>Bagagerum</span>
          <strong>{trunk}</strong>
          {can('rearTrunkToggle') && data.trunk ? (
            <ActionButton
              car={car}
              action="rearTrunkToggle"
              label={data.trunk === 'closed' ? 'Åbn bagagerum' : 'Luk bagagerum'}
              iconName={data.trunk === 'open' ? 'car-trunk-open' : 'car-trunk'}
              args={{direction: data.trunk === 'closed' ? 'open' : 'close'}}
              connected={connected}
            />
          ) : null}
        </div>
      ) : null}
      <Notice text={familyNotice(trunkWish)} />
    </section>
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
  const step = (delta: number) => {
    if (typeof target !== 'number' || !range) return;
    const value = target + delta * 0.5;
    if (value < range.min || value > range.max) return;
    send({car, action: 'temperature', args: {temperature: value}});
  };
  const battery = car.data?.batteryPercent;
  const low = car.status === 'observed' && typeof battery === 'number' && battery < LOW_BATTERY_PERCENT;
  const pendingAction = waiting(wish) ? (wish?.value as {action?: VehicleAction} | undefined)?.action : undefined;
  return (
    <section
      className="device-history vehicle-disclosure pv-tile pv-kit pv-kit-tile"
      data-kit="tile"
      data-kit-identity="tesla"
      aria-labelledby="vehicle-climate-title"
    >
      <h2 id="vehicle-climate-title" className="vehicle-section-heading pv-section-header">
        <span data-kit-text="section-title">Klima</span>
      </h2>
      <div className="pv-kit pv-kit-listrow pv-row" data-kit="listrow">
        <span>Klima</span>
        <strong>{CLIMATE_NAMES[climate.status ?? ''] ?? 'Ukendt'}</strong>
        {typeof climate.temperatureC === 'number' ? <small>{`${da(climate.temperatureC)} °C`}</small> : null}
        {can('climateOn') && climate.status ? (
          <KitButton
            className="pv-kit pv-kit-toggle pv-toggle"
            data-kit="toggle"
            data-kit-identity="tesla"
            role="switch"
            aria-checked={on}
            aria-busy={pendingAction === 'climateOn' || pendingAction === 'climateOff' ? true : undefined}
            aria-label={`Klima: ${on ? 'Tændt' : 'Slukket'}`}
            isDisabled={!enabled}
            onPress={() => {
              send({car, action: on ? 'climateOff' : 'climateOn'});
            }}
          >
            {pendingAction === 'climateOn' || pendingAction === 'climateOff'
              ? PROGRESS[pendingAction]
              : on
                ? 'Tændt'
                : 'Slukket'}
          </KitButton>
        ) : null}
      </div>
      {low && can('climateOn') && !on ? (
        <p className="pv-meta">{`Lavt batteri (${String(Math.round(battery))} %) · Tesla afviser måske klima`}</p>
      ) : null}
      {can('temperature') && on && typeof target === 'number' && range ? (
        <div className="pv-kit pv-kit-listrow pv-row vehicle-temperature" data-kit="listrow">
          <span>Måltemperatur</span>
          <KitButton
            className={BUTTON}
            data-kit="button"
            aria-label="Lavere temperatur"
            isDisabled={!enabled || target - 0.5 < range.min}
            onPress={() => {
              step(-1);
            }}
          >
            <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon('dash')} alt="" />
          </KitButton>
          <strong aria-live="polite">
            {pendingAction === 'temperature'
              ? `${da((wish?.value as {args?: VehicleArgs}).args?.temperature ?? target)} °C`
              : `${da(target)} °C`}
          </strong>
          <KitButton
            className={BUTTON}
            data-kit="button"
            aria-label="Højere temperatur"
            isDisabled={!enabled || target + 0.5 > range.max}
            onPress={() => {
              step(1);
            }}
          >
            <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon('plus')} alt="" />
          </KitButton>
        </div>
      ) : null}
      {can('defrostOn') && typeof climate.defrost === 'boolean' ? (
        <div className="pv-kit pv-kit-listrow pv-row" data-kit="listrow">
          <span>Afrimning</span>
          <ActionButton
            car={car}
            action={climate.defrost ? 'defrostOff' : 'defrostOn'}
            label={climate.defrost ? 'Stop afrimning' : 'Afrim ruder'}
            iconName="wind"
            connected={connected}
          />
        </div>
      ) : null}
      {(['driver', 'passenger'] as const).map(seat => {
        const action = seat === 'driver' ? 'driverSeatHeat' : 'passengerSeatHeat';
        const value = seat === 'driver' ? climate.driverSeatHeat : climate.passengerSeatHeat;
        if (!can(action)) return null;
        const wished = pendingAction === action ? (wish?.value as {args?: VehicleArgs}).args?.option : undefined;
        const shown = wished ?? value;
        return (
          <div
            key={seat}
            className="pv-kit pv-kit-listrow pv-row vehicle-seat"
            data-kit="listrow"
            role="radiogroup"
            aria-label={seat === 'driver' ? 'Fører' : 'Passager'}
          >
            <span>{seat === 'driver' ? 'Fører' : 'Passager'}</span>
            {SEAT_LEVELS.map(level => (
              <KitButton
                key={level}
                className="pv-panel-chip"
                role="radio"
                aria-checked={shown === level}
                aria-busy={wished === level ? true : undefined}
                isDisabled={!enabled}
                onPress={() => {
                  send({car, action, args: {option: level}});
                }}
              >
                {SEAT_NAMES[level]}
              </KitButton>
            ))}
          </div>
        );
      })}
      <Notice text={familyNotice(wish)} />
    </section>
  );
}

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
  return (
    <ConfirmOverlay
      content={shown ? confirmContent(shown, connected, car?.status === 'observed') : null}
      onCancel={close}
      onAccept={() => {
        if (!shown || !car) return;
        close();
        if (shown.local) send({car, action: shown.action, args: shown.args});
        else send({car, action: shown.action, args: shown.args, confirmation: shown.confirmation});
      }}
    />
  );
}

// Seneste hændelser: one recorded change per row, in the old screen's words for the field and value.
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
    <section
      className="device-history vehicle-history pv-history"
      data-detail-zone="history"
      aria-labelledby="vehicle-history-title"
    >
      <h2 id="vehicle-history-title" className="pv-section-header">
        Seneste hændelser
      </h2>
      {rows.length ? (
        <ol>
          {rows.map(item => (
            <li key={`${item.field}-${String(item.at)}`} className="pv-kit pv-kit-listrow pv-row" data-kit="listrow">
              <span>{item.text}</span>
              <small>{updatedWhen(item.at * 1000)}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="robot-history-note">Ingen hændelser at vise endnu.</p>
      )}
    </section>
  );
}

// The old hero (screens/vehicle/VehicleDetail.tsx): status, »Opdateret«, the model, the metrics, the battery rail and
// the dot car (.vehicle-dots: tires, empty body, the body filled to the battery level, the cabin), whose tone is the
// observed state. The dot car is the old artwork; it is drawn for a known model only (»Model Y«), else the icon.
function Hero({car, connected}: {car: VehicleRow; connected: boolean}) {
  const now = useNow();
  const data = car.data ?? {};
  const charging = data.charging?.status === 'charging';
  const artwork = car.modelName === 'Model Y';
  const battery = typeof data.batteryPercent === 'number' ? Math.max(0, Math.min(100, data.batteryPercent)) : null;
  const climateOn = data.climate?.status === 'heat_cool';
  const tone = !artwork
    ? 'none'
    : car.status === 'stale' || !connected
      ? 'unknown'
      : charging
        ? 'charging'
        : climateOn
          ? 'climate'
          : 'parked';
  const power = charging && typeof data.charging?.powerKw === 'number' ? `${da(data.charging.powerKw)} kW` : null;
  const endsAt =
    charging && typeof data.charging?.endsAt === 'number'
      ? new Date(data.charging.endsAt * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'})
      : null;
  const cabin = typeof data.climate?.temperatureC === 'number' ? `· kabine ${da(data.climate.temperatureC)}°` : '';
  const updated = vehicleUpdated(car, new Date(now));
  const hero = heroStatus(car, now);
  const status = car.status === 'stale' ? `Ikke opdateret · ${hero}` : hero;
  return (
    <section
      className="vehicle-hero pv-hero pv-kit pv-kit-hero"
      data-kit="hero"
      data-kit-identity="tesla"
      data-kit-state="ready"
      data-detail-zone="hero"
      data-charging={String(charging)}
      data-car-tone={tone}
      aria-label="Bilens status"
      style={{'--pv-car-level': String(battery === null ? 0 : battery / 100)} as CSSProperties}
    >
      <h2 className="vehicle-status" data-kit-slot="title" aria-live="polite">
        {status}
      </h2>
      <p className="vehicle-connection-note" data-kit-slot="body" hidden={!updated}>
        {updated}
      </p>
      <div className="vehicle-content">
        <figure className="vehicle-artwork" data-artwork-role="illustration" hidden={!artwork}>
          <figcaption className="vehicle-context">{car.modelName}</figcaption>
        </figure>
        <div className="vehicle-measurements">
          <dl className="vehicle-metrics">
            <div className="vehicle-metric" hidden={battery === null}>
              <dt>Batteri</dt>
              <dd className="vehicle-battery-value">
                {battery === null ? '—' : String(Math.round(battery))}
                {battery === null ? null : <span className="vehicle-battery-unit"> %</span>}
              </dd>
            </div>
            <div className="vehicle-metric" hidden={typeof data.rangeKm !== 'number'}>
              <dt>Rækkevidde</dt>
              <dd className="vehicle-range-value">
                {typeof data.rangeKm === 'number' ? `${da(data.rangeKm, 0)} km` : '—'}
              </dd>
              <dd className="vehicle-cabin-value" hidden={!cabin}>
                {cabin}
              </dd>
            </div>
            <div className="vehicle-metric" hidden={power === null}>
              <dt>Ladeeffekt</dt>
              <dd className="vehicle-charge-value">{power ?? ''}</dd>
            </div>
            <div className="vehicle-metric" hidden={endsAt === null}>
              <dt>Forventet færdig</dt>
              <dd className="vehicle-charge-value">{endsAt ?? ''}</dd>
            </div>
          </dl>
          <div className="vehicle-battery-rail" data-known={String(battery !== null)} hidden={battery === null}>
            {battery === null ? null : (
              <meter
                className="vehicle-battery-meter"
                min={0}
                max={100}
                value={battery}
                aria-label="Batteriniveau"
              />
            )}
          </div>
        </div>
      </div>
      <img
        className="--48 pv-kit pv-kit-icon pv-icon"
        src={icon('car-front')}
        alt=""
        data-kit-slot="icon"
        hidden={artwork}
      />
      <div className="vehicle-dots" aria-hidden="true">
        <i data-layer="tires" />
        <i data-layer="empty" />
        <i data-layer="fill" />
        <i data-layer="cabin" />
      </div>
    </section>
  );
}

export function VehicleScreen() {
  const {link, read, car, cars} = useVehicle();
  const history = useVehicleHistory(car?.deviceId ?? null, link.generation);
  if (!car) {
    const loading = read.isPending && link.connected;
    return (
      <section id="vehicle-view" className="response-widget" aria-labelledby="vehicle-title">
        <header className="response-heading">
          <div>
            <h1 id="vehicle-title">Tesla</h1>
            <p>{loading ? 'afventer svar…' : read.isError ? 'Status ukendt' : 'Ikke forbundet'}</p>
          </div>
        </header>
        {loading || read.isError ? null : (
          <p className="screen-explanation">Forbind bilen i Home Assistant for at se status her.</p>
        )}
      </section>
    );
  }
  return (
    <section
      id="vehicle-view"
      className="response-widget"
      aria-labelledby="vehicle-title"
      data-vehicle-mode="observed"
    >
      <header className="response-heading">
        <div>
          <h1 id="vehicle-title">Tesla</h1>
          <p>{car.name}</p>
        </div>
      </header>
      <VehicleChoice cars={cars} shown={car.deviceId} />
      <Hero car={car} connected={link.connected} />
      <section className="vehicle-secondary pv-controls" aria-label="Adgang og klima" data-detail-zone="controls">
        <div className="vehicle-control-tiles pv-tiles">
          <Access car={car} connected={link.connected} />
          {car.entities.climate ? <Climate car={car} connected={link.connected} /> : null}
        </div>
      </section>
      <History history={history.data} />
      <Confirmation car={car} connected={link.connected} />
    </section>
  );
}
