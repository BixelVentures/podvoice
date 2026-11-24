// Bil on HA: the household's Tesla from the PodVoice integration (podvoice.vehicle_panel_state; lib/ha/vehicle.ts).
// What the car last reported is shown with the old Bil screen's words (status line, Døre, Bagagerum, Klima, seats);
// a field the car has not reported is »Ukendt«, never guessed. Every control sends podvoice.vehicle_command: the
// integration keeps the add-on's risk model, so lock goes at once and everything else comes back as a confirmation
// that the dialog shows (wake, earlier unresolved requests, override) before it is sent once. The car's own HA entity
// is the proof; an answer that never came is »Udfald ukendt · kontrollér bilen.«, never resent.
import {useEffect} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {useEntities, useLink} from '../../lib/ha/transport';
import {
  CONFIRM_WINDOW_MS,
  UNKNOWN_OUTCOME,
  useVehicleCommands,
  useVehicleConfirm,
  useVehicleState,
  vehicleWishKey,
} from '../../lib/ha/vehicle';
import type {PendingConfirmation, VehicleAction, VehicleArgs, VehicleData, VehicleRow} from '../../lib/ha/vehicle';
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

// The old status line (vehicle-model.js): offline, trunk, charging, sleep and the lock, from what the car reported.
export function vehicleStatus(car: VehicleRow): string {
  const data = car.data;
  if (car.status === 'unavailable' || !data) return 'Status ukendt';
  if (car.connection?.state === 'offline') return 'Ikke forbundet';
  const lock = data.locked === true ? 'Låst' : data.locked === false ? 'Ulåst' : '';
  if (data.trunk === 'open') return ['Bagagerum åbent', lock].filter(Boolean).join(' · ');
  if (data.charging?.status === 'charging') return 'Bilen lader';
  return [car.connection?.state === 'asleep' ? 'I dvale' : '', lock].filter(Boolean).join(' · ') || 'Status ukendt';
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
  const anyWaiting = useStore(commands.store, state =>
    Object.values(state.wishes).some(wish => wish?.key.startsWith('vehicle:') && waiting(wish)),
  );
  const read = useVehicleState(link.generation, anyWaiting);
  const row = read.data?.vehicles[0] ?? null;
  const ids = LIVE_ROLES.map(role => row?.entities[role]).filter((id): id is string => !!id);
  const states = useEntities(ids);
  const live = Object.fromEntries(ids.map((id, index) => [id, states[index] ?? null]));
  const car = row ? withLiveEntities(row, live) : null;
  return {link, read, car};
}

// The Home tile's line: the car's status with its battery, '' while the first read runs, and null when HA has no
// Tesla Fleet car or the integration cannot be read: hide the tile then.
export function useVehicleLine(): string | null {
  const {link, read, car} = useVehicle();
  if (!car) return read.isPending && link.connected ? '' : null;
  const battery = car.data?.batteryPercent;
  return [
    car.status === 'stale' ? `Ikke opdateret · ${vehicleStatus(car)}` : vehicleStatus(car),
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
    <section className="vehicle-group" aria-labelledby="vehicle-access-title">
      <h2 id="vehicle-access-title" className="pv-kit pv-kit-sectionheader pv-section-header" data-kit="sectionheader">
        Adgang
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
    <section className="vehicle-group" aria-labelledby="vehicle-climate-title">
      <h2 id="vehicle-climate-title" className="pv-kit pv-kit-sectionheader pv-section-header" data-kit="sectionheader">
        Klima
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
        send({car, action: shown.action, args: shown.args, confirmation: shown.confirmation});
      }}
    />
  );
}

export function VehicleScreen() {
  const {link, read, car} = useVehicle();
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
  const data = car.data ?? {};
  const status = vehicleStatus(car);
  const charging = data.charging?.status === 'charging';
  const endsAt =
    charging && typeof data.charging?.endsAt === 'number'
      ? new Date(data.charging.endsAt * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'})
      : null;
  return (
    <section id="vehicle-view" className="response-widget" aria-labelledby="vehicle-title">
      <header className="response-heading">
        <div>
          <h1 id="vehicle-title">Tesla</h1>
          <p>{car.name}</p>
        </div>
      </header>
      <article
        className="pv-kit pv-kit-hero pv-hero vehicle-hero"
        data-kit="hero"
        data-kit-identity="tesla"
        data-charging={String(charging)}
        aria-label={`${car.name}: ${status}`}
      >
        <div className="pv-instrument" data-kit-slot="icon" aria-hidden="true">
          <img src={icon('car-front')} alt="" />
        </div>
        <div data-kit-slot="copy">
          <p className="pv-resource-value" data-kit-slot="title" role="status">
            {car.status === 'stale' ? `Ikke opdateret · ${status}` : status}
          </p>
          <p className="pv-meta vehicle-measurements" data-kit-slot="body">
            {[
              typeof data.batteryPercent === 'number' ? `${String(Math.round(data.batteryPercent))} %` : '',
              typeof data.rangeKm === 'number' ? `${da(data.rangeKm, 0)} km` : '',
              charging && typeof data.charging?.powerKw === 'number' ? `${da(data.charging.powerKw)} kW` : '',
              endsAt ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {typeof data.batteryPercent === 'number' ? (
            <meter min={0} max={100} value={data.batteryPercent} aria-label="Batteri" />
          ) : null}
        </div>
      </article>
      <Access car={car} connected={link.connected} />
      {car.entities.climate ? <Climate car={car} connected={link.connected} /> : null}
      <Confirmation car={car} connected={link.connected} />
    </section>
  );
}
