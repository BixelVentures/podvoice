// Timer card (lærred »A-Timer«): the Home overview bar and the timer page's detail card share it. Same anatomy,
// classes, kit attributes and aria as before, so the stage CSS and the browser journeys apply unchanged. The ring
// (--progress) and the digits move with motion/react (lib/motion/value.tsx).
import {motion} from 'motion/react';
import type {MotionStyle} from 'motion/react';
import type {CSSProperties} from 'react';
import {KitButton as Button} from '../../lib/ui/KitButton';
import {RollingDigits, useProgress} from '../../lib/motion/value';
import {useShell} from '../../lib/store/shell';
import type {CardSlot, Timer, TimerAccess} from './model';
import {adjustAllowed, cancelAllowed, cardActions, cardContent, cardRestart} from './presentation';
import type {TimerCompletion} from './presentation';
import {timerCommand} from './state';

const BUTTON = 'pv-kit pv-kit-button pv-btn';

// K-Btn icon slot (ui/kit.js syncKitButtonContent): a kit Icon and a label span inside the Button.
export function KitButtonContent({label, icon}: {label: string; icon: string | null}) {
  const style = icon ? ({'--pv-icon-source': `url("${icon}")`} as CSSProperties) : undefined;
  return (
    <>
      <span
        className="--24 pv-kit pv-kit-icon pv-icon"
        data-kit="icon"
        aria-hidden="true"
        hidden={!icon}
        style={style}
      />
      <span data-kit-slot="label">{label}</span>
    </>
  );
}

export interface TimerCardProps {
  timer: Timer;
  slot: CardSlot;
  access: TimerAccess;
  live: boolean;
  completion: TimerCompletion | undefined;
}

function Instrument({detail, total, long, time}: {detail: boolean; total: string; long: string; time: string}) {
  return (
    <span className="timer-instrument" aria-hidden="true" data-long={long}>
      <svg viewBox="0 0 120 120" className="pv-illu">
        <circle className="timer-track" cx="60" cy="60" r="54" />
        <circle className="timer-progress" cx="60" cy="60" r="54" pathLength={100} />
      </svg>
      {detail ? (
        <>
          <span className="timer-count">
            <RollingDigits text={time} still={2} />
          </span>
          <span className="timer-total" hidden={!total}>
            {total}
          </span>
        </>
      ) : (
        <img className="timer-icon" src="assets/icons/timer.svg" alt="" />
      )}
    </span>
  );
}

export function TimerCard({timer, slot, access, live, completion}: TimerCardProps) {
  const detail = slot === 'detail';
  const content = cardContent(timer, slot, {live, completion});
  const actions = detail ? cardActions(timer, access, live) : null;
  const restart = detail ? cardRestart(timer, access, live) : null;
  const finishDisabled = !cancelAllowed(access) || access.cancelBlockedIds.includes(timer.id);
  const [progress, panel] = useProgress<HTMLElement>(Number(content.progress), timer);
  const dispatch = useShell(state => state.dispatch);
  const focusHeading = useShell(state => state.focusHeading);
  const id = timer.id;
  const open = () => {
    dispatch({type: 'show', id: 'timers'});
    focusHeading();
  };
  const finish = () => {
    if (finishDisabled) return;
    timerCommand({type: 'timer', id, action: 'cancel'});
    focusHeading();
  };
  const toggle = () => {
    if (live || timer.ownerBootId || timer.stale || !['running', 'paused'].includes(timer.status)) return;
    dispatch({type: 'timer', id, action: timer.status === 'paused' ? 'resume' : 'pause', now: Date.now()});
  };
  const adjust = (deltaSeconds: number) => {
    if (adjustAllowed(timer, access, live, deltaSeconds))
      timerCommand({type: 'timer', action: 'adjust', id, deltaSeconds});
  };
  const copy = (
    <span className="timer-copy" data-state-label={content.stateLabel} data-state-repeat={content.repeat}>
      {detail ? null : (
        <span className="timer-count">
          <RollingDigits text={content.time} still={2} />
        </span>
      )}
      <strong hidden={!content.kicker}>{content.kicker}</strong>
      <span className="timer-state" hidden={!content.state}>
        {content.state}
      </span>
    </span>
  );
  return (
    <motion.article
      ref={panel}
      className="timer-panel pv-hero pv-kit pv-kit-hero"
      data-kit-tone="dark"
      data-kit="hero"
      data-kit-identity="neutral"
      data-timer-id={content.timerId}
      data-status={content.status}
      data-stale={content.stale}
      data-progress-known={content.progressKnown}
      aria-busy={access.waiting}
      style={{'--progress': progress} as MotionStyle}
    >
      {detail && actions && restart ? (
        <>
          <div className="timer-open" role="group" aria-label={content.openLabel}>
            <Instrument detail total={content.total} long={content.long} time={content.time} />
            {copy}
          </div>
          {/* Read-only content precedes the actions; native tab order matches the controls on the right. */}
          <div className="timer-actions" role="group" aria-label="Betjen timer" hidden={actions.hidden}>
            <Button
              data-timer-action="toggle"
              className={BUTTON}
              data-kit="button"
              data-kit-variant="primary"
              data-kit-size="56"
              data-kit-content="icon-label"
              hidden={actions.toggle.hidden}
              isDisabled={actions.toggle.disabled}
              onPress={toggle}
            >
              <KitButtonContent
                label={actions.toggle.label}
                icon={actions.toggle.label === 'Fortsæt' ? 'assets/icons/play-fill.svg' : null}
              />
            </Button>
            <Button
              className={`timer-adjust ${BUTTON}`}
              data-timer-action="adjust"
              data-delta-seconds="60"
              aria-label="1 minut mere"
              data-kit="button"
              data-kit-variant="icon"
              data-feedback="progress"
              aria-busy={actions.plus.loading}
              hidden={actions.plus.hidden}
              isDisabled={actions.plus.disabled}
              onPress={() => {
                adjust(60);
              }}
            >
              +1 min
            </Button>
            <Button
              className={`timer-adjust ${BUTTON}`}
              data-timer-action="adjust"
              data-delta-seconds="-60"
              aria-label="1 minut mindre"
              data-kit="button"
              data-kit-variant="icon"
              data-feedback="progress"
              aria-busy={actions.minus.loading}
              hidden={actions.minus.hidden}
              isDisabled={actions.minus.disabled}
              onPress={() => {
                adjust(-60);
              }}
            >
              −1 min
            </Button>
          </div>
          {/* K-Btn: »Stop alarm« is the alarm variant with the stop glyph. */}
          <Button
            className={`timer-finish ${BUTTON}`}
            data-kit="button"
            data-kit-variant={content.ringing ? 'alarm' : 'secondary'}
            data-kit-size="56"
            data-kit-content="icon-label"
            aria-label={content.finishAria}
            isDisabled={finishDisabled}
            onPress={finish}
          >
            <KitButtonContent label={content.finishLabel} icon={content.ringing ? 'assets/icons/stop-fill.svg' : null} />
          </Button>
          <Button
            className={`timer-restart ${BUTTON}`}
            data-kit="button"
            data-kit-variant="secondary"
            data-kit-size="56"
            data-kit-content="icon-label"
            hidden={restart.hidden}
            isDisabled={restart.disabled}
            onPress={() => {
              if (!restart.disabled && !restart.hidden)
                timerCommand({type: 'timer', id, action: 'restart', now: Date.now()});
            }}
          >
            <KitButtonContent label={restart.label} icon={restart.label ? 'assets/icons/arrow-refresh.svg' : null} />
          </Button>
          <TimerNote feedback={access.feedback} busy={access.waiting} />
        </>
      ) : (
        <>
          <Instrument detail={false} total="" long={content.long} time={content.time} />
          {copy}
          <Button
            className={`timer-finish ${BUTTON}`}
            data-kit="button"
            data-kit-variant="secondary"
            aria-label={content.finishAria}
            isDisabled={finishDisabled}
            onPress={finish}
          >
            {content.finishLabel}
          </Button>
          <Button className={`timer-open ${BUTTON}`} data-kit="button" aria-label={content.openLabel} onPress={open}>
            <img className="timer-chevron" src="assets/icons/chevron-right.svg" alt="" />
          </Button>
        </>
      )}
    </motion.article>
  );
}

// The one feedback slot of the timer page (#timers-live-note): in the detail card while a timer is shown, else in
// the draft (TimerScreen renders it there).
export function TimerNote({feedback, busy}: {feedback: string; busy: boolean}) {
  return (
    <p
      id="timers-live-note"
      role="status"
      className="pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-kit-variant="feedback"
      data-kit-text="meta"
      data-kit-slot="feedback"
      hidden={!feedback}
      aria-busy={busy}
    >
      {feedback}
    </p>
  );
}
