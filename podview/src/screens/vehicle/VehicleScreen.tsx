// Bil: the vehicle page (#vehicle-view). The shell mounts it once (mountVehicle); it draws the store's state
// (store.ts) through the pure presentation (presentation.ts). Same anatomy, classes, kit attributes and aria as the
// previous renderer, so the stage stylesheet and the browser journeys apply unchanged. Buttons are the kit's Button on
// React Aria's useButton; the seat levels are React Aria radio groups on the kit's native chips; the confirmation is
// the native <dialog> (showModal), opened and closed from the store's state.
// Motion (docs/MOTION.md): the only motion here is the finite charge acknowledgement on the battery meter, played
// after the new reading is in the DOM, through the shell's shared leaf motion (SceneMotion), as before.
import {useEffect, useLayoutEffect, useRef} from 'react';
import type {CSSProperties, DetailedHTMLProps, HTMLAttributes, ReactNode, Ref} from 'react';
import {mergeProps, useButton, useRadio, useRadioGroup} from 'react-aria';
import {useRadioGroupState} from 'react-stately';
import type {RadioGroupState} from 'react-stately';
import {useStore} from 'zustand';
import {mountScreen} from '../../app/mount';
import {useShell} from '../../lib/store/shell';
import {presentVehicle} from './presentation';
import type {ButtonView, FactGroupView, SeatGroupView} from './presentation';
import {LEVELS} from './rules';
import type {ButtonControl, Control, PressControl, Seat} from './rules';
import {vehicleStore} from './state';
import type {VehicleStore} from './store';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-activity-timeline': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

interface TimelineData {
  items: unknown[];
  readOnly: true;
  connected: false;
  quietStatus: true;
  state: 'ready' | 'empty';
}
type Timeline = HTMLElement & {data?: TimelineData};
interface ChargeMotion {
  animate?: (node: Element, frames: Keyframe[], duration: number) => Animation | null | undefined;
}

const BUTTON = 'text-control pv-button pv-kit pv-kit-button pv-btn';
const SEAT_GROUPS: readonly [Seat, string][] = [
  ['driver', 'Førersæde'],
  ['passenger', 'Passager'],
];
const ACCESS_LABELS = ['Døre og låse', 'Bagagerum', 'Vinduer'];
const CLIMATE_LABELS = ['Status', 'I kabinen', 'Afrimning', 'Sædevarme'];
const HEALTH_LABELS = ['Dæktryk · afhænger af bilen', 'Sentry Mode', 'Softwareopdatering'];
const MORE_LABELS = [
  'Væk bilen',
  'Lysblink og horn',
  'HomeLink · afhænger af bilen',
  'Nøglefri kørsel',
  'Bilens medieafspiller',
];

// The kit's icon + label anatomy (syncKitButtonContent), or the button's plain text.
function Content({view}: {view: ButtonView}): ReactNode {
  if (view.label === null) return view.text;
  const source = view.icon ? ({'--pv-icon-source': `url("${view.icon}")`} as CSSProperties) : undefined;
  return (
    <>
      <span
        className="--24 pv-kit pv-kit-icon pv-icon"
        data-kit="icon"
        aria-hidden="true"
        hidden={!view.icon}
        style={source}
      />
      <span data-kit-slot="label">{view.label}</span>
    </>
  );
}

// The kit attributes a button view carries.
function kitAttributes(view: ButtonView) {
  return {
    hidden: view.hidden,
    'data-kit-variant': view.variant,
    'data-tone': view.tone,
    'data-feedback': view.feedback,
    'aria-busy': view.busy,
    'data-state': view.state,
    'data-kit-content': view.label === null ? undefined : 'icon-label',
    'data-vehicle-tile': view.tile ? (view.tile.attention ? 'attention' : 'calm') : undefined,
    'data-tile-name': view.tile?.name,
    'data-tile-value': view.tile?.value,
    'data-defrost': view.defrost,
    'data-selected': view.selected,
  };
}

interface VehicleButtonProps extends HTMLAttributes<HTMLButtonElement> {
  view: ButtonView;
  className: string;
  onPress: () => void;
  buttonRef?: Ref<HTMLButtonElement | null> | undefined;
  children?: ReactNode;
  [data: `data-${string}`]: string | undefined;
}

// A kit Button on React Aria's useButton (press handling for touch, mouse, keyboard and assistive technology).
function VehicleButton({view, className, onPress, buttonRef, children, ...rest}: VehicleButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const {buttonProps} = useButton({isDisabled: view.disabled, onPress, elementType: 'button'}, ref);
  return (
    <button
      {...mergeProps(rest, buttonProps)}
      className={className}
      type="button"
      {...kitAttributes(view)}
      ref={node => {
        ref.current = node;
        if (typeof buttonRef === 'function') buttonRef(node);
        else if (buttonRef) buttonRef.current = node;
      }}
    >
      <Content view={view} />
      {children}
    </button>
  );
}

function FactRows({group, labels}: {group: FactGroupView; labels: readonly string[]}) {
  return (
    <dl className="vehicle-detail-values" hidden={group.bodyHidden}>
      {labels.map((label, index) => {
        const value = group.values[index];
        return (
          <div key={label} className="vehicle-fact-row pv-kit pv-kit-listrow pv-row" data-kit="listrow"
            hidden={value?.hidden ?? true}>
            <dt>{label}</dt>
            <dd>{value?.text ?? 'Ikke oplyst'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// The read-only capability groups: never shown until a real owner reports them.
function ReadOnlyGroup({title, labels}: {title: string; labels: readonly string[]}) {
  const group: FactGroupView = {
    detailHidden: true,
    status: 'Ikke oplyst',
    statusHidden: false,
    bodyHidden: true,
    values: labels.map(() => ({text: 'Ikke oplyst', hidden: true})),
  };
  return (
    <details className="device-history vehicle-disclosure pv-tile" hidden>
      <summary>
        <span data-kit-text="section-title">{title}</span>
        <small data-kit-text="body">{group.status}</small>
      </summary>
      <FactRows group={group} labels={labels} />
    </details>
  );
}

function SeatChoice({state, seat, level, label}: {state: RadioGroupState; seat: Seat; level: number; label: string}) {
  const ref = useRef<HTMLInputElement>(null);
  const {inputProps} = useRadio({value: String(level), children: label}, state, ref);
  const id = `vehicle-seat-${seat}`;
  return (
    <label className="pv-kit pv-kit-chip pv-chip pv-kit-choice-label" data-kit="chip">
      <input
        {...inputProps}
        ref={ref}
        name={id}
        id={`${id}-${String(level)}`}
        aria-disabled={state.isDisabled}
      />
      <span>{label}</span>
    </label>
  );
}

// One seat's heat level (the kit's level choice group): the observed or fixture level; a choice is a wish the
// store sends or reverts.
function SeatGroup({seat, label, group, onChange}: {
  seat: Seat;
  label: string;
  group: SeatGroupView;
  onChange: (seat: Seat, level: number) => void;
}) {
  const id = `vehicle-seat-${seat}`;
  const state = useRadioGroupState({
    value: String(group.value),
    isDisabled: group.disabled,
    name: id,
    onChange: value => {
      onChange(seat, Number(value));
    },
  });
  const {radioGroupProps, labelProps} = useRadioGroup({label, isDisabled: group.disabled, name: id}, state);
  return (
    <fieldset
      {...radioGroupProps}
      className="pv-kit-choice-group"
      data-choice-variant="level"
      hidden={group.hidden}
      aria-disabled={group.disabled}
    >
      <legend {...labelProps} data-kit-text="field-label">
        {label}
      </legend>
      <div className="pv-kit-choice-options" data-choice-count="4" style={{'--pv-choice-columns': '4'} as CSSProperties}>
        {LEVELS.map((level, index) => (
          <SeatChoice key={level} state={state} seat={seat} level={index} label={level} />
        ))}
      </div>
    </fieldset>
  );
}

export function VehicleScreen({store, container}: {store: VehicleStore; container: HTMLElement | null}) {
  const state = useStore(store);
  const view = presentVehicle(state);
  const motion = useShell(shell => shell.motion) as ChargeMotion | null;
  const timeline = useRef<Timeline>(null);
  const meter = useRef<HTMLMeterElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const seatTrigger = useRef<HTMLButtonElement | null>(null);
  const seatScroll = useRef<number | undefined>(undefined);
  const buttons = useRef(new Map<Control, HTMLButtonElement | null>());
  const actions = store.getState();
  const press = (control: PressControl) => () => {
    actions.control(control);
  };
  const register = (control: ButtonControl) => (node: HTMLButtonElement | null) => {
    buttons.current.set(control, node);
  };

  // The container's own state: the detail template, the vehicle class and the mode the stylesheet reads.
  useLayoutEffect(() => {
    if (!container) return;
    container.classList.add('pv-kit-template', 'pv-kit-template-detail', 'vehicle-view');
    container.dataset.kitTemplate = 'detail';
  }, [container]);
  useLayoutEffect(() => {
    if (!container) return;
    if (container.dataset.vehicleMode !== view.mode) container.dataset.vehicleMode = view.mode;
    const example = String(view.example);
    if (container.dataset.example !== example) container.dataset.example = example;
  }, [container, view.mode, view.example]);
  // The shared timeline renders from its `data` property: read-only, no history until a real owner reports one.
  const items = state.model.history;
  useLayoutEffect(() => {
    if (!timeline.current) return;
    timeline.current.data = {
      items,
      readOnly: true,
      connected: false,
      quietStatus: true,
      state: items.length ? 'ready' : 'empty',
    };
  }, [items]);
  // A finite acknowledgement of a fresh charging reading, after the meter shows it.
  const cue = state.chargeCue;
  const played = useRef(cue);
  useLayoutEffect(() => {
    if (cue === played.current) return;
    played.current = cue;
    if (meter.current) {
      store.getState().setChargeAnimation(motion?.animate?.(meter.current, [{opacity: 0.65}, {opacity: 1}], 120));
    }
  }, [cue, motion, store]);
  // The confirmation is the native modal dialog; the page keeps its reading position.
  const open = view.dialogOpen;
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      const top = container?.scrollTop ?? 0;
      node.showModal();
      if (container) container.scrollTop = top;
    } else if (!open && node.open) node.close();
  }, [open, container]);
  // Focus returns to the control that asked for the confirmation.
  const focus = state.focus;
  useEffect(() => {
    if (focus) buttons.current.get(focus.control)?.focus({preventScroll: true});
  }, [focus]);
  // The seat panel opens in view and closes back to the reading position; focus inside it returns to its trigger.
  const expanded = view.seats.expanded;
  const wasExpanded = useRef(expanded);
  useLayoutEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    if (expanded) {
      seatScroll.current = container?.scrollTop;
      panel.current?.scrollIntoView({block: 'nearest', behavior: 'instant'});
      return;
    }
    if (panel.current?.contains(panel.current.ownerDocument.activeElement)) seatTrigger.current?.focus();
    if (container) container.scrollTop = seatScroll.current ?? 0;
  }, [expanded, container]);

  const button = (target: ButtonView, control: ButtonControl, extra: Record<string, string> = {}) => (
    <VehicleButton
      view={target}
      className={BUTTON}
      data-kit="button"
      data-kit-identity="neutral"
      onPress={press(control)}
      buttonRef={register(control)}
      {...extra}
    />
  );
  const liveButton = (control: 'lock' | 'unlock' | 'climateOn' | 'climateOff', label: string, slot?: string) =>
    button(view.live[control], control, {'data-live-vehicle-label': label, ...(slot ? {'data-kit-slot': slot} : {})});
  const {access, climate, notes, seats} = view;
  return (
    <>
      <header className="response-heading pv-topbar">
        <div>
          <h1>{view.title}</h1>
        </div>
      </header>
      <section
        className="vehicle-hero pv-hero pv-kit pv-kit-hero"
        aria-label="Bilens status"
        data-detail-zone="hero"
        data-kit="hero"
        data-kit-identity="tesla"
        data-charging={String(view.hero.charging)}
        data-kit-state={view.hero.kitState}
        data-kit-variant={view.hero.message ? 'message' : undefined}
        data-car-tone={view.hero.carTone}
        style={{'--pv-car-level': view.hero.carLevel} as CSSProperties}
      >
        <h2 className="vehicle-status" data-kit-slot="title">
          {view.status}
        </h2>
        <p className="vehicle-connection-note" data-kit-slot="body" hidden={view.connectionNote.hidden}>
          {view.connectionNote.text}
        </p>
        <div className="vehicle-content" hidden={view.contentHidden}>
          <figure
            className="vehicle-artwork"
            data-artwork-role="illustration"
            hidden={view.figure.hidden}
            data-image-state={view.figure.imageState}
          >
            <img
              className="vehicle-image"
              alt=""
              width={1280}
              height={853}
              decoding="async"
              draggable={false}
              hidden={view.image.hidden}
              src={view.image.src}
              onLoad={() => {
                actions.imageLoaded();
              }}
              onError={() => {
                actions.imageFailed();
              }}
            />
            <figcaption className="vehicle-context" hidden={view.context.hidden}>
              {view.context.text}
            </figcaption>
          </figure>
          <div className="vehicle-measurements" hidden={view.measurementsHidden}>
            <dl className="vehicle-metrics">
              <div className="vehicle-metric" hidden={view.battery.hidden}>
                <dt>Batteri</dt>
                <dd className="vehicle-battery-value">
                  {view.battery.number}
                  {view.battery.unit ? <span className="vehicle-battery-unit"> %</span> : null}
                </dd>
              </div>
              <div className="vehicle-metric" hidden={view.range.hidden}>
                <dt>Rækkevidde</dt>
                <dd className="vehicle-range-value">{view.range.text}</dd>
                <dd className="vehicle-cabin-value" hidden={view.cabin.hidden}>
                  {view.cabin.text}
                </dd>
              </div>
              <div className="vehicle-metric" hidden={view.power.hidden}>
                <dt>Ladeeffekt</dt>
                <dd className="vehicle-charge-value">{view.power.text}</dd>
              </div>
              <div className="vehicle-metric" hidden={view.finish.hidden}>
                <dt>Forventet færdig</dt>
                <dd className="vehicle-charge-value">{view.finish.text}</dd>
              </div>
            </dl>
            <div className="vehicle-battery-rail" data-known={String(view.rail.known)} hidden={view.rail.hidden}>
              <meter
                ref={meter}
                className="vehicle-battery-meter"
                min={0}
                max={100}
                aria-label="Batteriniveau"
                hidden={view.meter.hidden}
                value={view.meter.value}
              />
            </div>
          </div>
        </div>
        <img
          className="--48 pv-kit pv-kit-icon pv-icon"
          src="assets/icons/car-front.svg"
          alt=""
          data-kit-slot="icon"
          data-kit="icon"
          hidden={view.heroIconHidden}
        />
        <div className="vehicle-dots" aria-hidden="true">
          <i data-layer="tires" />
          <i data-layer="empty" />
          <i data-layer="fill" />
          <i data-layer="cabin" />
        </div>
      </section>
      <section
        className="vehicle-secondary pv-controls"
        aria-label="Adgang og klima"
        data-detail-zone="controls"
        hidden={view.secondaryHidden}
      >
        <div className="vehicle-control-tiles pv-tiles">
          <section
            className="device-history vehicle-disclosure pv-tile pv-kit pv-kit-tile"
            data-vehicle-section="access"
            data-kit="tile"
            data-kit-identity="tesla"
            hidden={access.detailHidden}
          >
            <h2 className="vehicle-section-heading pv-section-header">
              <span data-kit-text="section-title">Adgang</span>
              <small data-kit-text="body" hidden={access.statusHidden}>
                {access.status}
              </small>
              <Feedback note={notes.access} />
            </h2>
            <FactRows group={access} labels={ACCESS_LABELS} />
            <div className="vehicle-lock-controls" hidden={view.lockControlsHidden}>
              {liveButton('lock', 'Lås bilen')}
              {liveButton('unlock', 'Lås op')}
              {button(view.lockButton, 'lockButton')}
              {button(view.rearTrunkButton, 'rearTrunkButton')}
            </div>
          </section>
          <section
            className="device-history vehicle-disclosure pv-tile pv-kit pv-kit-tile"
            data-kit="tile"
            data-kit-identity="tesla"
            data-kit-layout={climate.layout}
            hidden={climate.detailHidden}
          >
            <h2 className="vehicle-section-heading pv-section-header" data-kit-slot="header">
              <span data-kit-text="section-title">Klima</span>
              <small data-kit-text="body" hidden={climate.statusHidden}>
                {climate.status}
              </small>
              <Feedback note={notes.climate} />
            </h2>
            <FactRows group={climate} labels={CLIMATE_LABELS} />
            <p className="vehicle-climate-note" data-kit-text="meta" hidden={view.climateBatteryNote.hidden}>
              {view.climateBatteryNote.text}
            </p>
            <VehicleButton
              view={view.climateToggle}
              className="pv-kit pv-kit-toggle pv-toggle"
              data-kit="toggle"
              data-kit-slot="header-action"
              role="switch"
              aria-checked={view.climateToggle.checked ? 'true' : 'false'}
              aria-label="Klima"
              onPress={press('climateToggle')}
              buttonRef={register('climateToggle')}
            >
              <span data-kit-slot="switch-track" aria-hidden="true">
                <span data-kit-slot="switch-thumb" />
              </span>
            </VehicleButton>
            <section
              className="vehicle-temperature-controls vehicle-control-tile pv-tile"
              aria-label="Måltemperatur"
              hidden={view.temperatureControlsHidden}
            >
              {button(view.temperatureDown, 'temperatureDown', {'aria-label': 'Sænk temperatur'})}
              <output data-kit-text="control-value">{view.temperatureValue}</output>
              {button(view.temperatureUp, 'temperatureUp', {'aria-label': 'Hæv temperatur'})}
            </section>
            {liveButton('climateOn', 'Tænd klima', 'header-action')}
            {liveButton('climateOff', 'Sluk klima', 'header-action')}
            <div className="vehicle-climate-actions" hidden={view.climateActionsHidden}>
              {button(view.defrostButton, 'defrostButton')}
            </div>
            <section className="pv-kit-disclosure" hidden={seats.hidden}>
              <SeatTrigger
                expanded={seats.expanded}
                disabled={seats.disabled}
                description={seats.description}
                onPress={actions.toggleSeats}
                triggerRef={seatTrigger}
              />
              <div
                ref={panel}
                id="vehicle-seat-heat-panel"
                aria-labelledby="vehicle-seat-heat-trigger"
                role="region"
                hidden={!seats.expanded}
              >
                {SEAT_GROUPS.map(([seat, label]) => (
                  <SeatGroup key={seat} seat={seat} label={label} group={seats.groups[seat]}
                    onChange={actions.seatChange} />
                ))}
              </div>
            </section>
          </section>
        </div>
        <ReadOnlyGroup title="Bilens tilstand" labels={HEALTH_LABELS} />
        <ReadOnlyGroup title="Flere muligheder" labels={MORE_LABELS} />
      </section>
      <section className="device-history vehicle-history pv-history" data-detail-zone="history"
        hidden={view.historyHidden}>
        <h2 className="pv-section-header">Seneste hændelser</h2>
        <pv-activity-timeline ref={timeline} hidden={view.timelineHidden} />
        <p className="robot-history-note" hidden={view.emptyHidden}>
          Ingen hændelser at vise endnu.
        </p>
      </section>
      <dialog
        ref={dialog}
        className="vehicle-confirmation pv-kit pv-kit-dialog pv-dialog"
        data-action-layout="balanced"
        aria-labelledby="vehicle-confirm-title"
        aria-describedby="vehicle-confirm-description"
        data-kit="dialog"
        data-kit-variant="default"
        onCancel={() => {
          actions.dialogClosed();
        }}
        onClose={() => {
          actions.dialogClosed();
        }}
      >
        <header className="pv-dialog-header">
          <h2 id="vehicle-confirm-title">{view.dialog.title}</h2>
        </header>
        <p id="vehicle-confirm-description" className="pv-dialog-description">
          {view.dialog.note}
        </p>
        <div className="pv-dialog-actions">
          <VehicleButton view={view.cancel} className="pv-kit pv-kit-button pv-btn" data-kit="button"
            data-kit-identity="neutral" onPress={press('lockCancel')} />
          <VehicleButton view={view.confirm} className="pv-primary pv-kit pv-kit-button pv-btn" data-kit="button"
            data-kit-identity="neutral" onPress={press('lockConfirm')} />
        </div>
      </dialog>
    </>
  );
}

// The seat heat disclosure's trigger (the kit's disclosure row): opens the levels; disabled while climate is off.
function SeatTrigger({expanded, disabled, description, onPress, triggerRef}: {
  expanded: boolean;
  disabled: boolean;
  description: string;
  onPress: () => void;
  triggerRef: Ref<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const {buttonProps} = useButton({isDisabled: disabled, onPress, elementType: 'button'}, ref);
  return (
    <button
      {...buttonProps}
      className="pv-kit pv-kit-listrow pv-row"
      type="button"
      id="vehicle-seat-heat-trigger"
      aria-controls="vehicle-seat-heat-panel"
      aria-expanded={expanded}
      aria-disabled={disabled}
      data-kit="listrow"
      data-leading-icon="true"
      data-has-summary={String(!!description)}
      ref={node => {
        ref.current = node;
        if (typeof triggerRef === 'function') triggerRef(node);
        else if (triggerRef) triggerRef.current = node;
      }}
    >
      <img
        className="pv-kit pv-kit-icon pv-icon"
        data-kit="icon"
        src="assets/icons/seat.svg"
        alt=""
        data-kit-slot="leading-icon"
      />
      <span data-kit-slot="copy">
        <strong data-kit-text="group-title" data-kit-slot="title">
          Sædevarme
        </strong>
        <small data-kit-text="meta" data-kit-slot="description" hidden={!description}
          aria-hidden={!description}>
          {description}
        </small>
      </span>
    </button>
  );
}

function Feedback({note}: {note: {text: string; state: string | undefined; hidden: boolean}}) {
  return (
    <span
      className="pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-kit-variant="feedback"
      role="status"
      aria-live="polite"
      data-kit-slot="status"
      data-state={note.state}
      hidden={note.hidden}
    >
      {note.text}
    </span>
  );
}

// The shell mounts the page once; React owns everything inside.
export function mountVehicle(container: HTMLElement, store: VehicleStore = vehicleStore) {
  return mountScreen(container, <VehicleScreen store={store} container={container} />);
}
