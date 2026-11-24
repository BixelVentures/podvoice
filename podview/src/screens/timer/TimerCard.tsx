// Timer card (lærred »A-Timer«): one timer of the PodVoice timer bridge on the Timer page. The ring (its circle's
// strokeDashoffset) and the digits move with motion/react (lib/motion/value.tsx); the card's material breathes while
// the timer runs and the ring pulses while a finished timer rings (both still with reduced motion, and while the
// Timer screen waits out of sight). The bridge owns the timers, so
// the card offers what the bridge can do: ±1 min while a timer runs, Annuller, and Stop alarm / Færdig at the end.
import {motion, useReducedMotion, useTransform} from 'motion/react';
import type {MotionValue} from 'motion/react';
import {useShown} from '../../lib/motion/shown';
import {RollingDigits, useProgress} from '../../lib/motion/value';
import {TRANSITION} from '../../lib/motion/tokens';
import {LastKnown} from '../../panel/ui';
import {Button, cx, Icon} from '../../ui';
import type {Timer, TimerAccess, TimerEvent} from './model';
import {adjustAllowed, cancelAllowed, cardActions, cardContent} from './presentation';

export interface TimerCardProps {
  timer: Timer;
  access: TimerAccess;
  // The owner of the commands (the HA panel's timer bridge).
  onCommand: (event: TimerEvent & {now?: number}) => void;
}

// The card's material, right of the ring: brighter while the timer runs, dimmer while it is paused.
function Material({status}: {status: string}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const breathes = status === 'running' && !reduced && shown;
  return (
    <motion.span
      key={breathes ? 'breathes' : 'still'}
      aria-hidden="true"
      className={cx(
        'pointer-events-none absolute top-0 right-0 h-[458px] w-[520px] bg-[url(/assets/timer/timer-material.svg)]',
        'bg-size-[520px_458px] bg-right bg-no-repeat [mask-image:linear-gradient(90deg,transparent_0,#000_200px)]',
        status === 'paused' ? 'opacity-30' : 'opacity-55',
      )}
      {...(breathes
        ? {
            animate: {opacity: [0.4, 0.6, 0.4]},
            transition: TRANSITION.ambient(2),
          }
        : {})}
    />
  );
}

function Instrument({progress, done, known, total, long, time}: {
  progress: MotionValue<number>;
  done: boolean;
  known: boolean;
  total: string;
  long: boolean;
  time: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const pulses = done && known && !reduced && shown;
  // The dash is the progress: a full-length dash pushed back by what is left (only this circle repaints).
  const offset = useTransform(progress, value => 100 - value);
  return (
    <span className="relative grid size-[340px] place-items-center content-center gap-1.5" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-[340px] -rotate-90">
        <circle className="fill-none stroke-pv-dark-2" strokeWidth={7.76} cx="60" cy="60" r="54" />
        <motion.circle
          key={pulses ? 'pulses' : 'still'}
          className={cx(
            'fill-none stroke-pv-timer-accent [stroke-dasharray:100_100]',
            known ? '' : 'invisible',
          )}
          strokeWidth={7.76}
          strokeLinecap="round"
          cx="60"
          cy="60"
          r="54"
          pathLength={100}
          style={{strokeDashoffset: done ? 0 : offset}}
          {...(pulses ? {animate: {opacity: [0.45, 1, 0.45]}, transition: TRANSITION.ambient()} : {})}
        />
      </svg>
      <span
        className={cx(
          'relative font-pv-mono font-medium tracking-[-0.06em] text-pv-on-dark',
          long ? 'text-[60px]' : 'text-[88px]',
          'leading-none',
          done && 'text-center',
        )}
      >
        <RollingDigits text={time} still={2} />
      </span>
      {total ? <span className="relative text-pv-body leading-[1.2] text-pv-on-dark-3">{total}</span> : null}
    </span>
  );
}

export function TimerCard({timer, access, onCommand: command}: TimerCardProps) {
  const content = cardContent(timer, 'detail', {live: true, completion: undefined});
  const actions = cardActions(timer, access, true);
  const finishDisabled = !cancelAllowed(access) || access.cancelBlockedIds.includes(timer.id);
  const [progress, panel] = useProgress<HTMLElement>(Number(content.progress), timer);
  const id = timer.id;
  const done = content.status === 'done';
  const adjusting = !actions.hidden;
  const finish = () => {
    if (finishDisabled) return;
    command({type: 'timer', id, action: 'cancel'});
  };
  const adjust = (deltaSeconds: number) => {
    if (adjustAllowed(timer, access, true, deltaSeconds)) command({type: 'timer', action: 'adjust', id, deltaSeconds});
  };
  const key = 'h-14 min-h-14 px-pv-s3 text-pv-body leading-none';
  return (
    <motion.article
      ref={panel}
      className={cx(
        'relative h-[458px] shrink-0 overflow-hidden rounded-[24px] bg-pv-dark p-pv-s4 text-pv-on-dark',
        'shadow-[inset_0_0_0_1px_rgb(23_23_26/0.06)] group-data-[link=offline]/host:opacity-55',
      )}
      data-timer-id={content.timerId}
      data-status={content.status}
      aria-busy={access.waiting}
    >
      <Material status={content.status} />
      <div
        className="relative z-[1] grid h-[394px] grid-cols-[340px_minmax(0,1fr)] items-center gap-pv-s5 text-left"
        role="group"
        aria-label={content.openLabel}
      >
        <Instrument
          progress={progress}
          done={done}
          known={content.progressKnown === 'true'}
          total={content.total}
          long={content.long === 'true'}
          time={content.time}
        />
        <span
          className={cx(
            'flex flex-col items-start gap-3',
            done ? 'mt-[57px] self-start' : adjusting ? 'pb-[142px]' : 'pb-[76px]',
          )}
        >
          {content.kicker ? (
            <strong className="block text-pv-body leading-[1.2] font-semibold wrap-anywhere text-pv-on-dark-3">
              {content.kicker}
            </strong>
          ) : null}
          <span
            className={cx(
              'text-[48px] leading-[1.02] font-extrabold tracking-[-0.03em]',
              done ? 'text-pv-timer-accent' : 'text-pv-on-dark',
            )}
          >
            {content.stateLabel}
          </span>
          {/* The state under the title, unless it says the same (its place is kept). */}
          {content.state ? (
            <span
              className={cx('text-[18px] leading-[1.3] text-pv-on-dark-2', content.repeat === 'true' && 'invisible')}
            >
              {content.state}
            </span>
          ) : null}
        </span>
      </div>
      {/* Read-only content precedes the actions; native tab order matches the controls on the right. */}
      {adjusting ? (
        <div className="absolute top-[calc(50%+7px)] left-[412px] z-[1] flex w-[300px] gap-2.5" role="group"
          aria-label="Betjen timer">
          <Button
            className={cx(key, 'bg-pv-on-dark text-pv-ink')}
            aria-label="1 minut mere"
            busy={actions.plus.loading}
            isDisabled={actions.plus.disabled}
            onPress={() => {
              adjust(60);
            }}
          >
            +1 min
          </Button>
          <Button
            className={cx(key, 'bg-pv-dark-2 text-pv-on-dark')}
            aria-label="1 minut mindre"
            busy={actions.minus.loading}
            isDisabled={actions.minus.disabled}
            onPress={() => {
              adjust(-60);
            }}
          >
            −1 min
          </Button>
        </div>
      ) : null}
      {/* »Stop alarm« is the alarm's colour with the stop glyph. */}
      <Button
        className={cx(
          key,
          'absolute left-[412px] z-[1]',
          adjusting ? 'top-[calc(50%+73px)]' : done ? 'top-[calc(50%+14px)]' : 'top-[calc(50%+42px)]',
          done ? 'bg-pv-timer-accent text-pv-ink' : 'bg-pv-dark-2 text-pv-on-dark',
          content.ringing && 'pr-[26px] pl-[22px]',
        )}
        aria-label={content.finishAria}
        isDisabled={finishDisabled}
        onPress={finish}
      >
        {content.ringing ? <Icon name="stop-fill" className="size-5" /> : null}
        {content.finishLabel}
      </Button>
      <TimerNote feedback={access.feedback} busy={access.waiting} />
      <LastKnown className="text-pv-on-dark-3" />
    </motion.article>
  );
}

// The card's one feedback line (an unknown or refused outcome), under the ring.
export function TimerNote({feedback, busy}: {feedback: string; busy: boolean}) {
  return (
    <p className="relative z-[1] text-pv-meta text-pv-on-dark-2" role="status" hidden={!feedback} aria-busy={busy}>
      {feedback}
    </p>
  );
}
