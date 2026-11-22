// Timer: the timer page (#timers-view), the Home overview bar (#timer-card .timer-active-list) and the topbar chip
// (#header-timer). The shell mounts each once (mountTimer); they read the stores and the query cache. Lærred
// »A-Timer«: the current timer's detail card, the new-timer draft and »Tidligere timere«; »A-Topbar«: a running
// timer is a chip in the topbar on every page but Timer.
import {motion} from 'motion/react';
import type {MotionStyle} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';
import {mountScreen} from '../../app/mount';
import {RollingDigits, useProgress} from '../../lib/motion/value';
import {readSnapshot} from '../../lib/query/live';
import {useShell} from '../../lib/store/shell';
import {KitButton} from '../../lib/ui/KitButton';
import {canStartTimer, pageModel, recentChoices} from './presentation';
import {completeStart, timerCommand, timerCommands, useTimerScene} from './state';
import type {StartToken} from './commands';
import {TimerCard, TimerNote} from './TimerCard';
import {adjustTimerDuration, readTimerDuration, timerProgress, timerStateLabel, timerTime} from './timer-model';
import {useTimer} from './useTimer';

const BUTTON = 'pv-kit pv-kit-button pv-btn';
const PRESETS = [3, 5, 10, 15];

interface Draft {
  hours: string;
  minutes: string;
  seconds: string;
}

const draftOf = (total: number): Draft => ({
  hours: String(Math.floor(total / 3600)),
  minutes: String(Math.floor((total % 3600) / 60)),
  seconds: String(total % 60),
});

// The exact entry (hidden; the steppers, presets and history fill it). Uncontrolled and memoized: an unchanged
// page writes nothing to it, and a fill remounts it with the new values.
function ExactFields({draft, disabled, onChange}: {draft: Draft; disabled: boolean; onChange: (draft: Draft) => void}) {
  const field = (name: keyof Draft, label: string, max: number) => (
    <label>
      {label}
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min="0"
        max={String(max)}
        defaultValue={draft[name]}
        required
        disabled={disabled}
        onChange={event => {
          onChange({...draft, [name]: event.currentTarget.value});
        }}
      />
    </label>
  );
  return (
    <div className="timer-duration">
      {field('hours', 'Timer', 24)}
      {field('minutes', 'Minutter', 59)}
      {field('seconds', 'Sekunder', 59)}
    </div>
  );
}

export function TimerScreen() {
  const {scene, current, access, completion} = useTimer();
  const [draft, setDraft] = useState<Draft>(() => draftOf(300));
  // The exact fields are uncontrolled (they only follow a fill), so an unchanged page writes nothing to them.
  const [fills, setFills] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const seconds = readTimerDuration(draft.hours, draft.minutes, draft.seconds);
  const recent = recentChoices(scene.timerHistory);
  const page = pageModel({current, seconds, access, recent});
  const focused = scene.focus === 'timers';
  // A Start token only lives while the page is in front.
  useEffect(() => {
    if (!focused) timerCommands.setState({startNavigation: null});
  }, [focused]);
  const fill = (total: number) => {
    if (current || !Number.isInteger(total) || total < 1 || total > 86400) return;
    setDraft(draftOf(total));
    setFills(fills + 1);
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (seconds === null || !canStartTimer(current, access)) return;
    const snapshot = readSnapshot();
    const token: StartToken = {
      sessionId: scene.sessionId,
      generation: scene.generation,
      bootId: snapshot?.bootId,
      roomId: snapshot?.roomId,
      epoch: snapshot?.timers.epoch,
    };
    timerCommands.setState({startNavigation: focused ? token : null});
    timerCommand({type: 'timer-start', seconds, name: ''});
    if (scene.live) return;
    // The local preview starts at once: back to Home when the new timer runs.
    const started = useTimerScene.getState().timers.find(timer => timer.status === 'running' && !timer.stale);
    if (focused && started && !current) completeStart(token, started.id, snapshot);
    timerCommands.setState({startNavigation: null});
  };
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
          {current ? (
            <TimerCard key={current.id} timer={current} slot="detail" access={access} live={scene.live}
              completion={completion} />
          ) : null}
        </div>
      </section>
      <form
        className="timer-create pv-card pv-kit pv-kit-card"
        data-kit-tone="dark"
        aria-label="Ny timer"
        data-kit="card"
        hidden={page.formHidden}
        aria-busy={page.formBusy}
        onSubmit={submit}
        ref={form}
      >
        <h2 tabIndex={-1}>Ny timer</h2>
        <div className="timer-stepper">
          <KitButton
            className={`timer-adjust ${BUTTON}`}
            data-adjust="-60"
            aria-label="1 minut mindre"
            data-kit="button"
            data-kit-variant="secondary"
            isDisabled={page.minusDisabled}
            onPress={() => {
              fill(adjustTimerDuration(seconds ?? 300, -60));
            }}
          >
            <img src="assets/icons/dash.svg" alt="" />
          </KitButton>
          <div className="timer-selected" data-long={page.long}>
            <output aria-live="polite" aria-label="Valgt tid">
              {page.time}
            </output>
            <span>{page.unit}</span>
          </div>
          <KitButton
            className={`timer-adjust ${BUTTON}`}
            data-adjust="60"
            aria-label="1 minut mere"
            data-kit="button"
            data-kit-variant="secondary"
            isDisabled={page.plusDisabled}
            onPress={() => {
              fill(adjustTimerDuration(seconds ?? 300, 60));
            }}
          >
            <img src="assets/icons/plus.svg" alt="" />
          </KitButton>
        </div>
        <div className="timer-presets" role="group" aria-label="Faste tider">
          {PRESETS.map(minutes => (
            <KitButton
              key={minutes}
              data-minutes={String(minutes)}
              aria-pressed="false"
              className="pv-kit pv-kit-chip pv-chip"
              data-kit="chip"
              isDisabled={page.draftDisabled}
              onPress={() => {
                fill(minutes * 60);
              }}
            >
              {`${String(minutes)} min`}
            </KitButton>
          ))}
        </div>
        <div className="timer-create-footer">
          <KitButton
            type="submit"
            className={`timer-start ${BUTTON}`}
            data-kit="button"
            data-kit-variant="primary"
            isDisabled={page.startDisabled}
          >
            <img src="assets/icons/play-fill.svg" alt="" />
            Start timer
          </KitButton>
        </div>
        <div id="timer-exact" hidden>
          <ExactFields key={fills} draft={draft} disabled={page.draftDisabled} onChange={setDraft} />
          <p className="timer-validation" role="status" hidden={page.validationHidden}>
            Vælg mellem 1 sekund og 24 timer.
          </p>
        </div>
        {current ? null : <TimerNote feedback={access.feedback} busy={access.waiting} />}
      </form>
      {/* Lærred »A-Timer« »Tidligere timere«: the product's own history; a tap fills the draft only. */}
      <section className="timer-recent" hidden={page.recentHidden}>
        <h2>Tidligere timere</h2>
        <span className="timer-recent-note">Justér før start</span>
        <div className="timer-recent-list" role="group" aria-label="Tidligere timere">
          {page.recent.map(choice => (
            <KitButton
              key={choice.seconds}
              className="timer-recent-choice"
              data-recent-seconds={String(choice.seconds)}
              aria-label={`${choice.time}, ${choice.label}. Justér før start`}
              isDisabled={page.recentWaiting}
              onPress={() => {
                fill(choice.seconds);
                // »Justér før start«: the draft comes into view with Start (or its title) focused.
                form.current?.scrollIntoView({block: 'nearest', behavior: 'instant'});
                const start = form.current?.querySelector<HTMLButtonElement>('.timer-start');
                if (start && !start.disabled) start.focus({preventScroll: true});
                else form.current?.querySelector<HTMLElement>('h2')?.focus({preventScroll: true});
              }}
            >
              <span className="timer-recent-time">{choice.time}</span>
              <span className="timer-recent-label">{choice.label}</span>
            </KitButton>
          ))}
        </div>
      </section>
    </>
  );
}

// The Home overview bar: the current timer's compact card (the shell shows or hides the bar and its shortcut).
export function HomeTimer() {
  const {scene, current, access, completion} = useTimer({visibleOnly: true});
  return current ? (
    <TimerCard key={current.id} timer={current} slot="overview" access={access} live={scene.live}
      completion={completion} />
  ) : null;
}

// Lærred »A-Topbar«: a running or paused timer's chip; a tap opens Timer.
export function HeaderTimer() {
  const {scene, current} = useTimer({visibleOnly: true});
  const dispatch = useShell(state => state.dispatch);
  const focusHeading = useShell(state => state.focusHeading);
  const shown = !!current && ['running', 'paused'].includes(current.status) && !current.stale && scene.focus !== 'timers';
  const time = current ? timerTime(current.remaining) : '';
  const [progress, chip] = useProgress<HTMLButtonElement>(current ? (timerProgress(current) ?? 100) : 100,
    current ?? {id: '', remaining: 0, status: 'none'});
  return (
    <motion.button
      ref={chip}
      type="button"
      id="header-timer"
      className="header-timer"
      hidden={!shown}
      aria-label={shown ? `Timer ${time}, ${timerStateLabel(current)}` : undefined}
      style={{'--progress': progress} as MotionStyle}
      onClick={() => {
        dispatch({type: 'show', id: 'timers'});
        focusHeading();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="timer-track" cx="12" cy="12" r="9" />
        <circle className="timer-progress" cx="12" cy="12" r="9" pathLength={100} />
      </svg>
      <span>{shown ? <RollingDigits text={time} still={2} /> : null}</span>
    </motion.button>
  );
}

// The shell's three containers, mounted once.
export function mountTimer({page, overview, header}: {page: Element; overview: Element; header: Element | null}) {
  const roots = [mountScreen(page, <TimerScreen />), mountScreen(overview, <HomeTimer />)];
  if (header) roots.push(mountScreen(header, <HeaderTimer />));
  return roots;
}
