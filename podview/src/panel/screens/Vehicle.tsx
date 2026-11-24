// Bil on HA: the household's Tesla from the PodVoice integration (podvoice.vehicle_panel_state; lib/ha/vehicle.ts).
// What the car last reported is shown with the old Bil screen's words (status line, Døre, Bagagerum, Klima, seats);
// a field the car has not reported is »Ukendt«, never guessed. Every control sends podvoice.vehicle_command: the
// integration keeps the add-on's risk model, so lock goes at once and everything else comes back as a confirmation
// that the dialog shows (wake, earlier unresolved requests, override) before it is sent once. The car's own HA entity
// is the proof; an answer that never came is »Udfald ukendt · kontrollér bilen.«, never resent.
import {useEffect, useId} from 'react';
import {useNow} from '../../lib/hooks/clock';
import type {CSSProperties, ReactNode} from 'react';
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
import {Button, Card, Chip, Choices, Icon, IconButton, listRow, Switch, tv} from '../../ui';
import {useNav} from '../nav';
import {Notice, REJECTED_TEXT, Shortcut} from '../ui';
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
    <Choices
      aria-label="Tesla"
      value={shown}
      onChange={deviceId => {
        useVehicleChoice.setState({deviceId});
      }}
    >
      {cars.map(car => (
        <Chip key={car.deviceId} id={car.deviceId}>
          {car.name}
        </Chip>
      ))}
    </Choices>
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
      tone="tesla"
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
}

function ActionButton({car, action, label, iconName, args, connected}: ActionButtonProps) {
  const send = useVehicleCommands();
  const wish = useFamilyWish(car, action);
  const mine = waiting(wish) && (wish?.value as {action?: string} | undefined)?.action === action;
  return (
    <Button
      size="sm"
      className="ml-auto bg-pv-surface"
      data-vehicle-action={action}
      busy={mine}
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
      <Icon name={iconName} />
      {mine ? PROGRESS[action] : label}
    </Button>
  );
}

// Adgang and Klima: two tiles of rows, each row a fact (what the car reported) and its control.
const ROW = 'flex min-h-pv-hit flex-wrap items-center gap-x-pv-s2 gap-y-pv-s1 rounded-pv-s bg-pv-surface-2 p-pv-s2';

function Tile({id, title, children}: {id: string; title: string; children: ReactNode}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-pv-s1 rounded-[24px] bg-pv-surface p-pv-s3
        shadow-[inset_0_0_0_1px_rgba(23,23,26,0.06)]"
      aria-labelledby={id}
    >
      <h2 id={id} className="mb-1 flex min-h-11 items-center text-[24px] leading-7 font-[800] tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({label, value, extra}: {label: string; value: string; extra?: string | undefined}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-pv-meta text-pv-ink-2">{label}</span>
      <span className="flex items-baseline gap-pv-s1">
        <strong className="text-pv-body font-bold">{value}</strong>
        {extra ? <small className="text-pv-meta text-pv-ink-2">{extra}</small> : null}
      </span>
    </span>
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
    <Tile id="vehicle-access-title" title="Adgang">
      <div className={ROW}>
        <Fact label="Døre" value={door} />
        {can('lock') && data.locked !== true ? (
          <ActionButton car={car} action="lock" label="Lås bilen" iconName="lock" connected={connected} />
        ) : null}
        {can('unlock') && data.locked !== false ? (
          <ActionButton car={car} action="unlock" label="Lås op" iconName="lock-open" connected={connected} />
        ) : null}
      </div>
      <Notice text={familyNotice(lockWish)} />
      {car.entities.trunk ? (
        <div className={ROW}>
          <Fact label="Bagagerum" value={trunk} />
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
    </Tile>
  );
}

function Seat({label, value, busy, disabled, onChange}: {
  label: string;
  value: string | null;
  busy: string | undefined;
  disabled: boolean;
  onChange: (level: string) => void;
}) {
  const labelId = useId();
  return (
    <div className={ROW}>
      <span id={labelId} className="w-full text-pv-meta text-pv-ink-2">
        {label}
      </span>
      <Choices
        aria-labelledby={labelId}
        className="grid w-full grid-cols-4 gap-pv-s1"
        value={value}
        isDisabled={disabled}
        onChange={level => {
          onChange(level);
        }}
      >
        {SEAT_LEVELS.map(level => (
          <Chip
            key={level}
            id={level}
            size="sm"
            className="min-w-0 bg-pv-surface px-0 font-semibold"
            data-busy={busy === level ? 'true' : undefined}
          >
            {SEAT_NAMES[level]}
          </Chip>
        ))}
      </Choices>
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
  const step = (delta: number) => {
    if (typeof target !== 'number' || !range) return;
    const value = target + delta * 0.5;
    if (value < range.min || value > range.max) return;
    send({car, action: 'temperature', args: {temperature: value}});
  };
  const battery = car.data?.batteryPercent;
  const low = car.status === 'observed' && typeof battery === 'number' && battery < LOW_BATTERY_PERCENT;
  const pendingAction = waiting(wish) ? (wish?.value as {action?: VehicleAction} | undefined)?.action : undefined;
  const switching = pendingAction === 'climateOn' || pendingAction === 'climateOff';
  const fact = (
    <Fact
      label="Klima"
      value={CLIMATE_NAMES[climate.status ?? ''] ?? 'Ukendt'}
      extra={typeof climate.temperatureC === 'number' ? `${da(climate.temperatureC)} °C` : undefined}
    />
  );
  return (
    <Tile id="vehicle-climate-title" title="Klima">
      {can('climateOn') && climate.status ? (
        <Switch
          aria-label={`Klima: ${on ? 'Tændt' : 'Slukket'}`}
          isSelected={on}
          isDisabled={!enabled}
          className="rounded-pv-s py-pv-s2 data-[selected]:bg-pv-surface-2 data-[selected]:text-pv-ink"
          onChange={() => {
            send({car, action: on ? 'climateOff' : 'climateOn'});
          }}
        >
          {fact}
          <span
            className="ml-auto flex min-h-12 items-center rounded-pv-pill bg-pv-surface px-pv-s2 font-semibold
              in-data-[selected]:bg-pv-dark in-data-[selected]:text-pv-on-dark"
            data-busy={switching ? 'true' : undefined}
          >
            {switching ? PROGRESS[pendingAction] : on ? 'Tændt' : 'Slukket'}
          </span>
        </Switch>
      ) : (
        <div className={ROW}>{fact}</div>
      )}
      {low && can('climateOn') && !on ? (
        <p className="text-pv-meta text-pv-ink-2">
          {`Lavt batteri (${String(Math.round(battery))} %) · Tesla afviser måske klima`}
        </p>
      ) : null}
      {can('temperature') && on && typeof target === 'number' && range ? (
        <div className={ROW}>
          <span className="w-full text-pv-meta text-pv-ink-2">Måltemperatur</span>
          <IconButton
            size="round"
            className="bg-pv-surface"
            aria-label="Lavere temperatur"
            isDisabled={!enabled || target - 0.5 < range.min}
            onPress={() => {
              step(-1);
            }}
          >
            <Icon name="dash" />
          </IconButton>
          <strong className="flex-1 text-center text-pv-body font-bold whitespace-nowrap" aria-live="polite">
            {pendingAction === 'temperature'
              ? `${da((wish?.value as {args?: VehicleArgs}).args?.temperature ?? target)} °C`
              : `${da(target)} °C`}
          </strong>
          <IconButton
            size="round"
            className="bg-pv-surface"
            aria-label="Højere temperatur"
            isDisabled={!enabled || target + 0.5 > range.max}
            onPress={() => {
              step(1);
            }}
          >
            <Icon name="plus" />
          </IconButton>
        </div>
      ) : null}
      {can('defrostOn') && typeof climate.defrost === 'boolean' ? (
        <div className={ROW}>
          <span className="text-pv-body">Afrimning</span>
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
        return (
          <Seat
            key={seat}
            label={seat === 'driver' ? 'Fører' : 'Passager'}
            value={wished ?? value ?? null}
            busy={wished}
            disabled={!enabled}
            onChange={level => {
              send({car, action, args: {option: level}});
            }}
          />
        );
      })}
      <Notice text={familyNotice(wish)} />
    </Tile>
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
    <Card className="flex flex-col gap-pv-s2" aria-labelledby="vehicle-history-title">
      <h2 id="vehicle-history-title" className="text-pv-label font-semibold tracking-[-0.015em]">
        Seneste hændelser
      </h2>
      {rows.length ? (
        <ol className="grid gap-pv-s1">
          {rows.map(item => (
            <li key={`${item.field}-${String(item.at)}`} className={listRow({className: 'rounded-pv-s'})}>
              <span>{item.text}</span>
              <small className="ml-auto text-pv-meta text-pv-ink-2">{updatedWhen(item.at * 1000)}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-pv-meta text-pv-ink-2">Ingen hændelser at vise endnu.</p>
      )}
    </Card>
  );
}

// The hero's tone: the observed state's colours for the dot car and the title (the old Bil screen's).
const hero = tv({
  base: [
    'group/car relative h-[221px] w-full shrink-0 overflow-hidden rounded-[24px] text-pv-ink',
    'shadow-[inset_0_0_0_1px_rgba(23,23,26,0.06)] group-data-[link=offline]/host:opacity-55',
  ],
  variants: {
    tone: {
      none: 'bg-pv-tesla [--car-title:var(--color-pv-ink)]',
      parked: 'bg-pv-tesla [--car-empty:rgba(23,23,26,0.1)] [--car-fill:#5E6B63] [--car-title:var(--color-pv-ink)]',
      charging: 'bg-[#CDE8D8] [--car-empty:rgba(23,23,26,0.12)] [--car-fill:var(--color-pv-ok)] [--car-title:#17442F]',
      climate: 'bg-[#CDE8D8] [--car-empty:rgba(23,23,26,0.12)] [--car-fill:var(--color-pv-ok)] [--car-title:#17442F]',
      unknown: 'bg-pv-tesla [--car-empty:rgba(23,23,26,0.08)] [--car-fill:#8C918D] [--car-title:var(--color-pv-ink-2)]',
    },
  },
});
type Tone = 'none' | 'parked' | 'charging' | 'climate' | 'unknown';

// The dot car's layers: one dotted mask each (public/assets/vehicle), filled by the tone's colours.
const DOT =
  'absolute inset-0 block [mask:var(--car-mask)_left_top/270px_86px_no-repeat] ' +
  '[-webkit-mask:var(--car-mask)_left_top/270px_86px_no-repeat]';
const LAYERS = {
  tires: 'bg-pv-ink [--car-mask:url(/assets/vehicle/car-tires.svg)]',
  empty: 'bg-(--car-empty) [--car-mask:url(/assets/vehicle/car-body.svg)]',
  // Filled to the battery level, left to right; charging, the fill flows.
  fill:
    'bg-(--car-fill) [--car-mask:url(/assets/vehicle/car-body-fill.svg)] ' +
    '[clip-path:inset(0_calc(270px_-_2.7px_-_258.7px_*_var(--pv-car-level,0))_0_0)] ' +
    'group-data-[car-tone=charging]/car:[--car-mask:url(/assets/vehicle/car-body-flow.svg)]',
  // The cabin glows while the climate runs.
  cabin:
    'bg-[rgba(23,23,26,0.16)] [--car-mask:url(/assets/vehicle/car-cabin.svg)] ' +
    'group-data-[car-tone=climate]/car:bg-pv-timer-accent ' +
    'group-data-[car-tone=climate]/car:[--car-mask:url(/assets/vehicle/car-cabin-warm.svg)]',
} as const;

const METRIC_LABEL = 'order-1 text-pv-meta text-pv-ink-3 lowercase';
const METRIC_VALUE = 'font-pv-mono text-[22px] leading-[26px] font-medium tracking-[-0.04em] whitespace-nowrap';
const RANGE = 'text-[17px] leading-[22px] font-semibold whitespace-nowrap text-pv-ink-2';

// The old hero (screens/vehicle/VehicleDetail.tsx): status, »Opdateret«, the model, the metrics, the battery and
// the dot car (tires, empty body, the body filled to the battery level, the cabin), whose tone is the observed
// state. The dot car is the old artwork; it is drawn for a known model only (»Model Y«), else the icon.
function Hero({car, connected}: {car: VehicleRow; connected: boolean}) {
  const now = useNow();
  const data = car.data ?? {};
  const charging = data.charging?.status === 'charging';
  const artwork = car.modelName === 'Model Y';
  const battery = typeof data.batteryPercent === 'number' ? Math.max(0, Math.min(100, data.batteryPercent)) : null;
  const climateOn = data.climate?.status === 'heat_cool';
  const tone: Tone = !artwork
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
  const status = car.status === 'stale' ? `Ikke opdateret · ${heroStatus(car, now)}` : heroStatus(car, now);
  return (
    <section
      className={hero({tone})}
      data-charging={String(charging)}
      data-car-tone={tone}
      aria-label="Bilens status"
      style={{'--pv-car-level': String(battery === null ? 0 : battery / 100)} as CSSProperties}
    >
      <h2
        className="absolute top-[52px] left-7 max-w-[420px] truncate text-[40px] leading-[1.05] font-[800]
          tracking-[-0.03em] text-(--car-title)"
        aria-live="polite"
      >
        {status}
      </h2>
      <p className="absolute top-pv-s3 right-7 text-pv-meta font-semibold text-pv-ink-3" hidden={!updated}>
        {updated}
      </p>
      {artwork ? (
        <p className="absolute top-pv-s3 left-7 text-pv-meta font-semibold text-pv-ink-3">{car.modelName}</p>
      ) : null}
      <dl className="pointer-events-none absolute inset-0 z-1 flex items-end gap-7 px-7 pb-pv-s3">
        <div className="absolute top-[60px] right-7 flex items-baseline" hidden={battery === null}>
          <dt className="sr-only">Batteri</dt>
          <dd
            className="font-pv-mono text-[64px] leading-[0.85] font-medium tracking-[-0.07em] whitespace-nowrap
              text-(--car-title)"
          >
            {battery === null ? '—' : String(Math.round(battery))}
            {battery === null ? null : <span className="text-[32px] tracking-[-0.07em] text-pv-tesla-ink"> %</span>}
          </dd>
        </div>
        <div
          className="absolute top-[100px] left-7 flex items-baseline gap-[5px]"
          hidden={typeof data.rangeKm !== 'number'}
        >
          <dt className={`order-1 lowercase ${RANGE}`}>Rækkevidde</dt>
          <dd className={RANGE}>{typeof data.rangeKm === 'number' ? `${da(data.rangeKm, 0)} km` : '—'}</dd>
          <dd className={`order-2 ${RANGE}`} hidden={!cabin}>
            {cabin}
          </dd>
        </div>
        <div className="flex items-baseline gap-pv-s1" hidden={power === null}>
          <dt className={METRIC_LABEL}>Ladeeffekt</dt>
          <dd className={METRIC_VALUE}>{power ?? ''}</dd>
        </div>
        <div className="flex items-baseline gap-pv-s1" hidden={endsAt === null}>
          <dt className={METRIC_LABEL}>Forventet færdig</dt>
          <dd className={METRIC_VALUE}>{endsAt ?? ''}</dd>
        </div>
      </dl>
      {battery === null ? null : (
        <meter className="sr-only" min={0} max={100} value={battery} aria-label="Batteriniveau" />
      )}
      {artwork ? (
        <div className="pointer-events-none absolute right-5 bottom-pv-s2 h-[86px] w-[270px]" data-artwork="dots"
          aria-hidden="true">
          {(Object.keys(LAYERS) as (keyof typeof LAYERS)[]).map(layer => (
            <i key={layer} className={`${DOT} ${LAYERS[layer]}`} data-layer={layer} />
          ))}
        </div>
      ) : (
        <Icon name="car-front" className="absolute right-7 bottom-pv-s3 size-pv-icon-l" />
      )}
      <span className="absolute top-pv-s1 right-pv-s3 hidden text-pv-meta text-pv-ink-2
        group-data-[link=offline]/host:block" aria-hidden="true">
        Sidst kendt
      </span>
    </section>
  );
}

// The screen and its heading (Tesla and the car's name, or why there is none).
function Frame({line, observed, children}: {line: string; observed?: boolean; children?: ReactNode}) {
  return (
    <section
      id="vehicle-view"
      className="flex flex-[0_0_auto] flex-col gap-pv-s3 py-pv-s1"
      aria-labelledby="vehicle-title"
      data-vehicle-mode={observed ? 'observed' : undefined}
    >
      <header className="py-pv-s3">
        <h1 id="vehicle-title" className="mt-0 mb-2.5 text-pv-title leading-[1.12] font-semibold tracking-[-0.025em]">
          Tesla
        </h1>
        <p className="mt-pv-s1 text-pv-body leading-[1.4] text-pv-ink-3">{line}</p>
      </header>
      {children}
    </section>
  );
}

export function VehicleScreen() {
  const {link, read, car, cars} = useVehicle();
  const history = useVehicleHistory(car?.deviceId ?? null, link.generation);
  if (!car) {
    const loading = read.isPending && link.connected;
    return (
      <Frame line={loading ? 'afventer svar…' : read.isError ? 'Status ukendt' : 'Ikke forbundet'}>
        {loading || read.isError ? null : (
          <p className="text-pv-body text-pv-ink-2">Forbind bilen i Home Assistant for at se status her.</p>
        )}
      </Frame>
    );
  }
  return (
    <Frame line={car.name} observed>
      <VehicleChoice cars={cars} shown={car.deviceId} />
      <Hero car={car} connected={link.connected} />
      <section className="grid grid-cols-2 gap-pv-s2" aria-label="Adgang og klima">
        <Access car={car} connected={link.connected} />
        {car.entities.climate ? <Climate car={car} connected={link.connected} /> : null}
      </section>
      <History history={history.data} />
      <Confirmation car={car} connected={link.connected} />
    </Frame>
  );
}
