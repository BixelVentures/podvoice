// Radio: the radio page (#radio-view), lærred »A-Radio«. The shell mounts it once (mountRadio); it reads the live
// radio source (or the local preview's scene) and the connection. Same anatomy, classes, kit attributes and aria as
// the pre-React renderer, so the stage stylesheet applies unchanged; the station tiles keep the kit choice list's
// anatomy (pv-content > pv-list > kit buttons) in their own <pv-station-list> container.
// Motion (docs/MOTION.md): the needle slides on `left` by CSS (the documented exception in
// tests/podview/motion-compositor.test.mjs); a new station's logo pops in once, unless motion is reduced.
import {motion} from 'motion/react';
import type {DetailedHTMLProps, HTMLAttributes} from 'react';
import {useState} from 'react';
import {useStore} from 'zustand';
import {useShallow} from 'zustand/shallow';
import {mountScreen} from '../../app/mount';
import {radioStation, stations} from '../../lib/api/radio';
import type {RadioStation} from '../../lib/api/radio';
import {useReducedMotion} from '../../lib/motion/reduced';
import {useConnection} from '../../lib/query/live';
import {useShell} from '../../lib/store/shell';
import {KitButton} from '../../lib/ui/KitButton';
import {TICKS, radioChoiceState, radioDefaults, radioScreen, stationPosition} from './model';
import type {RadioInput, RadioListData, RadioListItem} from './model';
import {radioInput, radioSource, useRadioScene} from './state';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      // The station tiles' container: the kit choice list's anatomy, drawn by React (not a custom element).
      'pv-station-list': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

// A new station's logo pops in: 500 ms with a slight overshoot. The variant is named after the logo, so a new
// station runs it once on the same element (nothing is rebuilt).
const POP_IN = {opacity: [0, 1], scale: [0.6, 1], rotate: [-6, 0]};
const POP_TRANSITION = {duration: 0.5, ease: [0.2, 1.3, 0.4, 1] as [number, number, number, number]};

// The radio projection, re-read when the source, the scene or the connection changes. Equal projections keep the
// screen as it is.
export function useRadioInput(): RadioInput {
  const scene = useRadioScene();
  const connection = useConnection();
  return useStore(radioSource, useShallow(() => radioInput(scene, radioSource, connection)));
}

// One station tile (a kit Button on React Aria's useButton). A tile is pressed while its station is selected; its
// spinner shows while that station starts.
function StationTile({item, selected, disabled, onChoose}: {
  item: RadioListItem;
  selected: boolean;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <KitButton
      className="pv-button pv-kit pv-kit-button pv-btn"
      data-kit="button"
      data-option-id={item.id}
      data-feedback="label"
      aria-busy={item.loading}
      data-current="false"
      data-resource-status=""
      aria-pressed={selected}
      isDisabled={disabled}
      onPress={() => {
        onChoose(item.id);
      }}
    >
      <img className="pv-choice-icon" alt="" src={`assets/${item.icon}.svg`} />
      <strong>{item.label}</strong>
      <span className="pv-meta">{item.detail}</span>
    </KitButton>
  );
}

function StationTiles({list, onChoose}: {list: RadioListData; onChoose: (id: string) => void}) {
  const disabled = list.connected === false || list.state === 'unsupported';
  return (
    <pv-station-list
      aria-label="Radiostationer"
      className="radio-station-tiles pv-tiles pv-component"
      data-detail-zone="controls"
      data-component="choice-list"
      data-state={list.state}
    >
      <div className="pv-content">
        <div className="pv-list">
          {list.items.map(item => (
            <StationTile key={item.id} item={item} selected={list.selected === item.id} disabled={disabled}
              onChoose={onChoose} />
          ))}
        </div>
      </div>
    </pv-station-list>
  );
}

export interface RadioDetailProps {
  input: RadioInput;
  onChoose: (station: RadioStation) => void;
}

// The page for one projection. Pure apart from what it last showed: the logo and the needle keep the last station
// while none is shown, so they never jump on return.
export function RadioDetail({input, onChoose}: RadioDetailProps) {
  const values = radioDefaults(input);
  const {live, enabled, stationId, playing, pending} = values;
  const selected = !live || enabled ? (radioStation(stationId)?.id ?? null) : null;
  const playback = selected && typeof playing === 'boolean' ? playing : null;
  const choice = radioChoiceState(values, selected, playback);
  const model = radioScreen(values, selected, playback, choice.selectable);
  const {hero, feedback, list} = model;
  const station = hero.station;
  const [shown, setShown] = useState<{station: RadioStation; index: number} | null>(null);
  if (station && shown?.station !== station) setShown({station, index: hero.index});
  const art = shown ? `assets/radio-${shown.station.id}.svg` : '';
  const reduced = useReducedMotion();
  const choose = (id: string) => {
    // The choice rule: a selectable page; the same station only when it is not already playing (live) or never
    // (local preview).
    const next = radioStation(id);
    if (!choice.selectable || !next) return;
    if (next.id === selected && (!live || (playback === true && !pending))) return;
    onChoose(next);
  };
  return (
    <>
      <header className="response-heading pv-topbar" data-detail-zone="header">
        <div data-customize="radio">
          <h1>Radio</h1>
          <p>{model.subtitle}</p>
        </div>
      </header>
      <section
        className="radio-hero pv-hero pv-kit pv-kit-hero"
        data-kit="hero"
        data-kit-variant="message"
        data-kit-identity="neutral"
        aria-label="Radio"
        data-detail-zone="hero"
        data-kit-density="compact"
        data-kit-state={hero.available ? 'ready' : 'empty'}
        data-radio-phase={hero.phase}
        data-radio-station={station?.id || undefined}
      >
        <div className="radio-hero-top">
          {/* First choice or a new station: the logo pops in (500 ms, slight overshoot) unless motion is reduced. */}
          <motion.img
            className="radio-hero-art"
            data-kit-slot="icon"
            alt=""
            width={144}
            height={144}
            src={art || undefined}
            hidden={!station}
            initial={false}
            variants={art && !reduced ? {[art]: POP_IN} : {}}
            {...(art ? {animate: art} : {})}
            transition={POP_TRANSITION}
          />
          <div data-kit-slot="copy">
            <p className="radio-hero-status">{hero.statusLine}</p>
            <h2 data-kit-slot="title">{hero.title}</h2>
            <p className="pv-meta radio-hero-sub" data-kit-slot="body">{hero.body}</p>
            <p
              className="pv-kit pv-kit-listrow pv-row"
              data-kit="listrow"
              data-kit-variant="feedback"
              data-kit-slot="feedback"
              hidden={feedback.hidden}
              role="status"
              aria-live="polite"
              data-state={feedback.state}
            >
              {feedback.text}
            </p>
          </div>
        </div>
        <div className="radio-scale" role="img" aria-label={hero.scaleLabel}>
          <div className="radio-scale-ticks">
            {TICKS.map((height, index) => (
              <i key={index} className="radio-scale-tick" style={{height: `${String(height)}px`}} />
            ))}
          </div>
          {stations.map(({id, label}, index) => (
            <span
              key={id}
              className="radio-scale-mark"
              style={{left: stationPosition(index)}}
              data-current={String(index === hero.index)}
            >
              {label.split(' ')[0]}
            </span>
          ))}
          <i
            className="radio-scale-needle"
            hidden={!station}
            style={shown ? {left: stationPosition(shown.index)} : undefined}
          />
        </div>
      </section>
      <div className="radio-stations-head">
        <h2 className="radio-stations-title">Radiostationer</h2>
      </div>
      <StationTiles list={list} onChoose={choose} />
    </>
  );
}

// The live page: a tap is the radio source's explicit choice; in the local preview a scene event.
export function RadioScreen() {
  const input = useRadioInput();
  const selectLocalRadio = useShell(state => state.selectLocalRadio);
  return (
    <RadioDetail
      input={input}
      onChoose={station => {
        if (input.live) void radioSource.choose(station.id);
        else selectLocalRadio(station.id);
      }}
    />
  );
}

export function mountRadio(page: Element) {
  return mountScreen(page, <RadioScreen />);
}
