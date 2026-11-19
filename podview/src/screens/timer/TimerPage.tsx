// Timere (lærred »A-Timer«): the current timer's detail card, the new-timer draft and »Tidligere timere«.
// Same anatomy, ids, classes, kit attributes and aria as the pre-React renderer. The draft's number inputs are
// uncontrolled, as before: TimerView fills them on a preset, a step or a recent choice and reads them on input.
import {useLayoutEffect, useRef} from 'react';
import type {MouseEvent, SyntheticEvent} from 'react';
import {showValue} from '../../../ui/motion.js';
import type {CardState, TimerPageModel} from './model';
import {TimerCard} from './TimerCard';
import type {CardHandlers} from './TimerCard';

const BUTTON = 'pv-kit pv-kit-button pv-btn';
const PRESETS = [3, 5, 10, 15];

export interface PageHandlers {
  input: () => void;
  submit: (event: SyntheticEvent<HTMLFormElement>) => void;
  preset: (minutes: number) => void;
  step: (delta: number) => void;
  recent: (seconds: number, event: MouseEvent<HTMLButtonElement>) => void;
}

export function TimerPage({
  page,
  cards,
  motion,
  cardHandlers,
  handlers,
}: {
  page: TimerPageModel;
  cards: CardState[];
  motion: unknown;
  cardHandlers: CardHandlers;
  handlers: PageHandlers;
}) {
  const field = (name: string, label: string, max: number, value: string) => (
    <label>
      {label}
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min="0"
        max={String(max)}
        defaultValue={value}
        required
        disabled={page.draftDisabled}
      />
    </label>
  );
  return (
    <>
      <header className="response-heading">
        <div>
          <h1 id="timers-title" tabIndex={-1}>
            Timere
          </h1>
        </div>
      </header>
      <section className="timer-running pv-detail-zone" hidden={page.runningHidden}>
        <h2>{page.runningLabel}</h2>
        <div className="timer-active-list">
          {cards.map(card => (
            <TimerCard key={card.key} card={card} motion={motion} handlers={cardHandlers} />
          ))}
        </div>
      </section>
      <form
        className="timer-create pv-card pv-kit pv-kit-card"
        data-kit-tone="dark"
        aria-label="Ny timer"
        data-kit="card"
        hidden={page.formHidden}
        aria-busy={page.formBusy}
        onInput={handlers.input}
        onSubmit={handlers.submit}
      >
        <h2 tabIndex={-1}>Ny timer</h2>
        <div className="timer-stepper">
          <button
            type="button"
            className={`timer-adjust ${BUTTON}`}
            data-adjust="-60"
            aria-label="1 minut mindre"
            data-kit="button"
            data-kit-variant="secondary"
            disabled={page.minusDisabled}
            onClick={() => {
              handlers.step(-60);
            }}
          >
            <img src="assets/icons/dash.svg" alt="" />
          </button>
          <div className="timer-selected" data-long={page.long}>
            <output aria-live="polite" aria-label="Valgt tid">
              {page.time}
            </output>
            <span>{page.unit}</span>
          </div>
          <button
            type="button"
            className={`timer-adjust ${BUTTON}`}
            data-adjust="60"
            aria-label="1 minut mere"
            data-kit="button"
            data-kit-variant="secondary"
            disabled={page.plusDisabled}
            onClick={() => {
              handlers.step(60);
            }}
          >
            <img src="assets/icons/plus.svg" alt="" />
          </button>
        </div>
        <div className="timer-presets" role="group" aria-label="Faste tider">
          {PRESETS.map(minutes => (
            <button
              key={minutes}
              type="button"
              data-minutes={String(minutes)}
              aria-pressed="false"
              className="pv-kit pv-kit-chip pv-chip"
              data-kit="chip"
              disabled={page.draftDisabled}
              onClick={() => {
                handlers.preset(minutes);
              }}
            >
              {`${String(minutes)} min`}
            </button>
          ))}
        </div>
        <div className="timer-create-footer">
          <button
            type="submit"
            className={`timer-start ${BUTTON}`}
            data-kit="button"
            data-kit-variant="primary"
            disabled={page.startDisabled}
          >
            <img src="assets/icons/play-fill.svg" alt="" />
            Start timer
          </button>
        </div>
        <div id="timer-exact" hidden>
          <div className="timer-duration">
            {field('hours', 'Timer', 24, '0')}
            {field('minutes', 'Minutter', 59, '5')}
            {field('seconds', 'Sekunder', 59, '0')}
          </div>
          <p className="timer-validation" role="status" hidden={page.validationHidden}>
            Vælg mellem 1 sekund og 24 timer.
          </p>
        </div>
      </form>
      {/* Lærred »A-Timer« »Tidligere timere«: the product's own history; a tap fills the draft only. */}
      <section className="timer-recent" hidden={page.recentHidden}>
        <h2>Tidligere timere</h2>
        <span className="timer-recent-note">Justér før start</span>
        <div className="timer-recent-list" role="group" aria-label="Tidligere timere">
          {page.recent.map(choice => (
            <button
              key={choice.seconds}
              type="button"
              className="timer-recent-choice"
              data-recent-seconds={String(choice.seconds)}
              aria-label={`${choice.time}, ${choice.label}. Justér før start`}
              disabled={page.recentWaiting}
              onClick={event => {
                handlers.recent(choice.seconds, event);
              }}
            >
              <span className="timer-recent-time">{choice.time}</span>
              <span className="timer-recent-label">{choice.label}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

// Lærred »A-Topbar«: the running timer's chip content. The chip itself (#header-timer, its visibility, label and
// ring progress) belongs to TimerView, which inserts it in the topbar beside the other context buttons.
export function HeaderTimerContent({time, motion}: {time: string | null; motion: unknown}) {
  const value = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (time !== null) showValue(motion, value.current, time, {still: 2});
  });
  return (
    <>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="timer-track" cx="12" cy="12" r="9" />
        <circle className="timer-progress" cx="12" cy="12" r="9" pathLength={100} />
      </svg>
      <span ref={value} />
    </>
  );
}
