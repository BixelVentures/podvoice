// Radio: the radio screen (#radio-view). Same anatomy, classes, kit attributes and aria as the pre-React
// renderer, so the stage stylesheet and the browser journeys apply unchanged. The station tiles are the shared
// <pv-choice-list> (podview/ui/library/components.js), which renders its own buttons from `data`.
// Motion (docs/MOTION.md): the needle slides on `left` by CSS (the documented exception in
// tests/podview/motion-compositor.test.mjs); a new station's logo pops in once, unless motion is reduced.
import {useLayoutEffect, useRef} from 'react';
import type {DetailedHTMLProps, HTMLAttributes} from 'react';
import {stations} from '../../../radio-model.js';
import {isReduced} from '../../../ui/motion.js';
import {TICKS, stationPosition} from './model';
import type {RadioListData, RadioScreenModel} from './model';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-choice-list': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

type ChoiceList = HTMLElement & {data?: RadioListData};

const POP_IN: Keyframe[] = [{opacity: 0, transform: 'scale(.6) rotate(-6deg)'}, {opacity: 1, transform: 'none'}];

export interface RadioDetailProps {
  model: RadioScreenModel;
  // The last station logo and needle position shown: both stay in place while no station is shown.
  art: string;
  needleLeft: string;
  onOpenPlayer: () => void;
}

export function RadioDetail({model, art, needleLeft, onOpenPlayer}: RadioDetailProps) {
  const {hero, feedback, list} = model;
  const station = hero.station;
  const listRef = useRef<ChoiceList>(null);
  const artRef = useRef<HTMLImageElement>(null);
  // The choice list renders from its `data` property; a new projection is one assignment, as before.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.data = list;
  }, [list]);
  // First choice or a new station: the logo pops in (500 ms, slight overshoot) unless motion is reduced.
  useLayoutEffect(() => {
    const image = artRef.current;
    if (!art || !image || isReduced(image)) return;
    image.animate(POP_IN, {duration: 500, easing: 'cubic-bezier(.2,1.3,.4,1)'});
  }, [art]);
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
          <img
            ref={artRef}
            className="radio-hero-art"
            data-kit-slot="icon"
            alt=""
            width={144}
            height={144}
            src={art || undefined}
            hidden={!station}
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
          <i className="radio-scale-needle" hidden={!station} style={needleLeft ? {left: needleLeft} : undefined} />
        </div>
      </section>
      <div className="radio-stations-head">
        <h2 className="radio-stations-title">Radiostationer</h2>
      </div>
      <pv-choice-list
        ref={listRef}
        aria-label="Radiostationer"
        className="radio-station-tiles pv-tiles"
        data-detail-zone="controls"
      />
      <button
        className="radio-open-player pv-button pv-kit pv-kit-listrow pv-row"
        type="button"
        data-kit="listrow"
        aria-label="Se afspiller"
        hidden
        onClick={onOpenPlayer}
      >
        Se afspiller
      </button>
    </>
  );
}
