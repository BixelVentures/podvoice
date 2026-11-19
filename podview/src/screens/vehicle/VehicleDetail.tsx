// Bil: the vehicle screen (#vehicle-view). Same anatomy, classes, kit attributes and aria as the pre-React
// renderer, so the stage stylesheet and the browser journeys apply unchanged. Every changeable element is drawn
// from its Face (screen.ts); the controller (VehicleView.tsx) owns what they show and every action.
// Motion (docs/MOTION.md): the only motion here is the finite charge acknowledgement on the battery meter, played
// from a layout effect after the new reading is in the DOM (the shared SceneMotion leaf animation, as before).
import {memo, useLayoutEffect, useRef} from 'react';
import type {CSSProperties, DetailedHTMLProps, HTMLAttributes, ReactNode} from 'react';
import type {Face, GroupFaces, Seat, SeatGroupFaces, VehicleScreen} from './screen';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-activity-timeline': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export interface TimelineData {
  items: unknown[];
  readOnly: true;
  connected: false;
  quietStatus: true;
  state: 'ready' | 'empty';
}

type Timeline = HTMLElement & {data?: TimelineData};

export type VehicleControl =
  | 'climateToggle'
  | 'temperatureDown'
  | 'temperatureUp'
  | 'lock'
  | 'unlock'
  | 'climateOn'
  | 'climateOff'
  | 'lockButton'
  | 'rearTrunkButton'
  | 'defrostButton'
  | 'seatTrigger'
  | 'lockCancel'
  | 'lockConfirm';

export interface VehicleDetailProps {
  screen: VehicleScreen;
  timeline: TimelineData | null;
  onControl: (control: VehicleControl) => void;
  onChargeCue: (meter: HTMLMeterElement) => void;
}

const SEATS: readonly [Seat, string][] = [
  ['driver', 'Førersæde'],
  ['passenger', 'Passager'],
];
const LEVELS = ['Fra', 'Lav', 'Mellem', 'Høj'];
const BUTTON = 'text-control pv-button pv-kit pv-kit-button pv-btn';

// The attributes a face carries, plus its hidden flag.
const show = (target: Face) => ({...target.attrs, hidden: target.hidden});

function Content({target}: {target: Face}): ReactNode {
  const content = target.content;
  if (!content) return target.text;
  const source = content.source ? ({'--pv-icon-source': content.source} as CSSProperties) : undefined;
  return (
    <>
      <span
        className="--24 pv-kit pv-kit-icon pv-icon"
        data-kit="icon"
        aria-hidden="true"
        hidden={!content.icon}
        style={source}
      />
      <span data-kit-slot="label">{content.label}</span>
    </>
  );
}

interface KitButtonProps {
  target: Face;
  className: string;
  control: VehicleControl;
  onControl: (control: VehicleControl) => void;
  children?: ReactNode;
}

function KitButton({target, className, control, onControl, children}: KitButtonProps) {
  return (
    <button
      className={className}
      type="button"
      {...show(target)}
      disabled={target.disabled}
      onClick={() => {
        onControl(control);
      }}
    >
      <Content target={target} />
      {children}
    </button>
  );
}

function FactRows({group, labels}: {group: GroupFaces; labels: readonly string[]}) {
  return (
    <dl className="vehicle-detail-values" {...show(group.body)}>
      {labels.map((label, index) => {
        const row = group.rows[index];
        const value = group.values[index];
        if (!row || !value) return null;
        return (
          <div key={label} className="vehicle-fact-row pv-kit pv-kit-listrow pv-row" {...show(row)}>
            <dt>{label}</dt>
            <dd {...show(value)}>{value.text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ReadOnlyGroup({group, title, labels}: {group: GroupFaces; title: string; labels: readonly string[]}) {
  return (
    <details className="device-history vehicle-disclosure pv-tile" {...show(group.detail)}>
      <summary>
        <span data-kit-text="section-title">{title}</span>
        <small {...show(group.status)}>{group.status.text}</small>
      </summary>
      <FactRows group={group} labels={labels} />
    </details>
  );
}

// React rewrites an input's name and type on every update; an unchanged seat choice is therefore not updated at all,
// so an identical render writes nothing.
interface SeatInputProps {
  id: string;
  name: string;
  value: string;
  target: Face;
}
const SeatInput = memo(
  function SeatInput({id, name, value, target}: SeatInputProps) {
    return <input type="radio" name={name} value={value} id={id} {...show(target)} disabled={target.disabled} />;
  },
  (before, after) =>
    before.id === after.id &&
    before.name === after.name &&
    before.value === after.value &&
    JSON.stringify(before.target) === JSON.stringify(after.target),
);

function SeatGroup({seat, label, group}: {seat: Seat; label: string; group: SeatGroupFaces}) {
  const id = `vehicle-seat-${seat}`;
  return (
    <fieldset className="pv-kit-choice-group" data-choice-variant="level" {...show(group.node)}>
      <legend data-kit-text="field-label">{label}</legend>
      <div
        className="pv-kit-choice-options"
        data-choice-count="4"
        style={{'--pv-choice-columns': '4'} as CSSProperties}
      >
        {LEVELS.map((level, index) => {
          const input = group.inputs[index];
          if (!input) return null;
          return (
            <label key={level} className="pv-kit pv-kit-chip pv-chip pv-kit-choice-label" data-kit="chip">
              <SeatInput id={`${id}-${String(index)}`} name={id} value={String(index)} target={input} />
              <span>{level}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function VehicleDetail({screen, timeline, onControl, onChargeCue}: VehicleDetailProps) {
  const {climate, access, live, seatControls} = screen;
  const timelineRef = useRef<Timeline>(null);
  const meterRef = useRef<HTMLMeterElement>(null);
  // The shared timeline renders from its `data` property; each vehicle render hands it one new projection.
  useLayoutEffect(() => {
    if (timelineRef.current && timeline) timelineRef.current.data = timeline;
  }, [timeline]);
  // A finite acknowledgement of a fresh charging reading, after the meter shows it.
  useLayoutEffect(() => {
    if (screen.chargeCue > 0 && meterRef.current) onChargeCue(meterRef.current);
  }, [screen.chargeCue, onChargeCue]);
  const button = (target: Face, control: VehicleControl, className = BUTTON) => (
    <KitButton target={target} className={className} control={control} onControl={onControl} />
  );
  return (
    <>
      <header className="response-heading pv-topbar">
        <div>
          <h1>{screen.title}</h1>
        </div>
      </header>
      <section
        className="vehicle-hero pv-hero pv-kit pv-kit-hero"
        aria-label="Bilens status"
        data-detail-zone="hero"
        {...show(screen.hero)}
        style={screen.carLevel ? ({'--pv-car-level': screen.carLevel} as CSSProperties) : undefined}
      >
        <h2 className="vehicle-status" data-kit-slot="title" {...show(screen.status)}>
          {screen.status.text}
        </h2>
        <p className="vehicle-connection-note" data-kit-slot="body" {...show(screen.connectionNote)}>
          {screen.connectionNote.text}
        </p>
        <div className="vehicle-content" {...show(screen.content)}>
          <figure className="vehicle-artwork" data-artwork-role="illustration" {...show(screen.figure)}>
            <img
              className="vehicle-image"
              alt=""
              width={1280}
              height={853}
              decoding="async"
              draggable={false}
              {...show(screen.image)}
            />
            <figcaption className="vehicle-context" {...show(screen.context)}>
              {screen.context.text}
            </figcaption>
          </figure>
          <div className="vehicle-measurements" {...show(screen.measurements)}>
            <dl className="vehicle-metrics">
              <div className="vehicle-metric" {...show(screen.batteryGroup)}>
                <dt>Batteri</dt>
                <dd className="vehicle-battery-value">
                  {screen.battery.number}
                  {screen.battery.unit ? <span className="vehicle-battery-unit"> %</span> : null}
                </dd>
              </div>
              <div className="vehicle-metric" {...show(screen.rangeGroup)}>
                <dt>Rækkevidde</dt>
                <dd className="vehicle-range-value">{screen.rangeValue.text}</dd>
                <dd className="vehicle-cabin-value" {...show(screen.cabinValue)}>
                  {screen.cabinValue.text}
                </dd>
              </div>
              <div className="vehicle-metric" {...show(screen.powerGroup)}>
                <dt>Ladeeffekt</dt>
                <dd className="vehicle-charge-value">{screen.powerValue.text}</dd>
              </div>
              <div className="vehicle-metric" {...show(screen.finishGroup)}>
                <dt>Forventet færdig</dt>
                <dd className="vehicle-charge-value">{screen.finishValue.text}</dd>
              </div>
            </dl>
            <div className="vehicle-battery-rail" {...show(screen.rail)}>
              <meter
                ref={meterRef}
                className="vehicle-battery-meter"
                min={0}
                max={100}
                aria-label="Batteriniveau"
                {...show(screen.meter)}
                value={screen.meterValue ?? undefined}
              />
            </div>
          </div>
        </div>
        <img
          className="--48 pv-kit pv-kit-icon pv-icon"
          src="assets/icons/car-front.svg"
          alt=""
          data-kit-slot="icon"
          {...show(screen.heroIcon)}
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
        {...show(screen.secondary)}
      >
        <div className="vehicle-control-tiles pv-tiles">
          <section
            className="device-history vehicle-disclosure pv-tile pv-kit pv-kit-tile"
            data-vehicle-section="access"
            data-kit="tile"
            data-kit-identity="tesla"
            {...show(access.detail)}
          >
            <h2 className="vehicle-section-heading pv-section-header">
              <span data-kit-text="section-title">Adgang</span>
              <small {...show(access.status)}>{access.status.text}</small>
              <span className="pv-kit pv-kit-listrow pv-row" {...show(screen.accessFeedback)}>
                {screen.accessFeedback.text}
              </span>
            </h2>
            <FactRows group={access} labels={['Døre og låse', 'Bagagerum', 'Vinduer']} />
            <div className="vehicle-lock-controls" {...show(screen.lockControls)}>
              {button(live.lock, 'lock')}
              {button(live.unlock, 'unlock')}
              {button(screen.lockButton, 'lockButton')}
              {button(screen.rearTrunkButton, 'rearTrunkButton')}
            </div>
          </section>
          <section
            className="device-history vehicle-disclosure pv-tile pv-kit pv-kit-tile"
            data-kit="tile"
            data-kit-identity="tesla"
            {...show(climate.detail)}
          >
            <h2 className="vehicle-section-heading pv-section-header" data-kit-slot="header">
              <span data-kit-text="section-title">Klima</span>
              <small {...show(climate.status)}>{climate.status.text}</small>
              <span className="pv-kit pv-kit-listrow pv-row" {...show(screen.climateFeedback)}>
                {screen.climateFeedback.text}
              </span>
            </h2>
            <FactRows group={climate} labels={['Status', 'I kabinen', 'Afrimning', 'Sædevarme']} />
            <p className="vehicle-climate-note" data-kit-text="meta" {...show(screen.climateBatteryNote)}>
              {screen.climateBatteryNote.text}
            </p>
            <KitButton
              target={screen.climateToggle}
              className="pv-kit pv-kit-toggle pv-toggle"
              control="climateToggle"
              onControl={onControl}
            >
              <span data-kit-slot="switch-track" aria-hidden="true">
                <span data-kit-slot="switch-thumb" />
              </span>
            </KitButton>
            <section
              className="vehicle-temperature-controls vehicle-control-tile pv-tile"
              aria-label="Måltemperatur"
              {...show(screen.temperatureControls)}
            >
              {button(screen.temperatureDown, 'temperatureDown')}
              <output data-kit-text="control-value" {...show(screen.temperatureValue)}>
                {screen.temperatureValue.text}
              </output>
              {button(screen.temperatureUp, 'temperatureUp')}
            </section>
            {button(live.climateOn, 'climateOn')}
            {button(live.climateOff, 'climateOff')}
            <div className="vehicle-climate-actions" {...show(screen.climateActions)}>
              {button(screen.defrostButton, 'defrostButton')}
            </div>
            <section className="pv-kit-disclosure" {...show(seatControls.node)}>
              <button
                className="pv-kit pv-kit-listrow pv-row"
                type="button"
                id="vehicle-seat-heat-trigger"
                aria-controls="vehicle-seat-heat-panel"
                data-leading-icon="true"
                {...show(seatControls.trigger)}
                disabled={seatControls.trigger.disabled}
                onClick={() => {
                  onControl('seatTrigger');
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
                  <small data-kit-text="meta" data-kit-slot="description" {...show(seatControls.description)}>
                    {seatControls.description.text}
                  </small>
                </span>
              </button>
              <div
                id="vehicle-seat-heat-panel"
                aria-labelledby="vehicle-seat-heat-trigger"
                role="region"
                {...show(seatControls.panel)}
              >
                {SEATS.map(([seat, label]) => (
                  <SeatGroup key={seat} seat={seat} label={label} group={screen.seatGroups[seat]} />
                ))}
              </div>
            </section>
          </section>
        </div>
        <ReadOnlyGroup
          group={screen.health}
          title="Bilens tilstand"
          labels={['Dæktryk · afhænger af bilen', 'Sentry Mode', 'Softwareopdatering']}
        />
        <ReadOnlyGroup
          group={screen.more}
          title="Flere muligheder"
          labels={[
            'Væk bilen',
            'Lysblink og horn',
            'HomeLink · afhænger af bilen',
            'Nøglefri kørsel',
            'Bilens medieafspiller',
          ]}
        />
      </section>
      <section
        className="device-history vehicle-history pv-history"
        data-detail-zone="history"
        {...show(screen.history)}
      >
        <h2 className="pv-section-header">Seneste hændelser</h2>
        <pv-activity-timeline ref={timelineRef} {...show(screen.timeline)} />
        <p className="robot-history-note" {...show(screen.empty)}>
          Ingen hændelser at vise endnu.
        </p>
      </section>
      <dialog
        className="vehicle-confirmation pv-kit pv-kit-dialog pv-dialog"
        data-action-layout="balanced"
        aria-labelledby="vehicle-confirm-title"
        aria-describedby="vehicle-confirm-description"
        data-kit="dialog"
        data-kit-variant="default"
      >
        <header className="pv-dialog-header">
          <h2 id="vehicle-confirm-title">{screen.confirmTitle.text}</h2>
        </header>
        <p id="vehicle-confirm-description" className="pv-dialog-description">
          {screen.confirmationNote.text}
        </p>
        <div className="pv-dialog-actions">
          {button(screen.lockCancel, 'lockCancel', 'pv-kit pv-kit-button pv-btn')}
          {button(screen.lockConfirm, 'lockConfirm', 'pv-primary pv-kit pv-kit-button pv-btn')}
        </div>
      </dialog>
    </>
  );
}
