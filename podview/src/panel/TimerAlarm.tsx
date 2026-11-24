// The full-screen timer alarm over the panel (lærred »Timer-Alarm«): when the PodVoice
// integration's timer bridge reports a finished timer (podvoice.timer_status `finished`), the page is covered by the
// alarm with »Timeren er færdig«, and Stop acknowledges it once (podvoice.timer_command_v2 acknowledge_finished). It
// needs no add-on. The bridge's next read is the proof: the row leaves and the alarm goes. »Luk visning« only hides
// this view; it never claims to stop the alarm on the device. Not modal: React Aria's FocusScope
// owns focus (into Stop, back where it was) and the page under it is never made inert. Motion: in from .94 on the
// snappy spring with a quick fade, out as a quick fade (docs/MOTION.md P2); reduced: the fade only. Transform and
// opacity only.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useState} from 'react';
import {FocusScope} from 'react-aria';
import {DUR, SPRING, springBezier} from '../lib/motion/tokens';
import type {Wish} from '../lib/ha/commands';
import {useTimerCommands} from '../lib/ha/timers';
import {TRANSITION} from '../lib/motion/tokens';
import {KitButton} from '../lib/ui/KitButton';
import type {Timer} from '../screens/timer/model';
import {timerDurationLabel} from '../screens/timer/timer-model';
import {useBridgeTimers} from './screens/Timers';
import {icon, wishNotice} from './ui';

// The first pulse of a new alarm lasts a minute (timer-notice.js).
export const PULSE_MS = 60_000;
const BUSY_TEXT = 'Afventer timerens svar';
const BLOCKED_NATIVE = 'Alarmen kan ikke stoppes herfra lige nu. Luk visning stopper ikke alarmen.';
const BLOCKED = 'Timeren kan ikke afsluttes herfra lige nu.';

const snappy = springBezier(SPRING.snappy);
const SNAPPY = {
  duration: snappy.ms / 1000,
  ease: (/cubic-bezier\(([^)]+)\)/.exec(snappy.easing)?.[1]?.split(',').map(Number) ?? [0.2, 0, 0, 1]) as [
    number,
    number,
    number,
    number,
  ],
};
const QUICK_FADE = {duration: DUR.quick / 1000, ease: 'easeOut' as const};

const waiting = (wish: Wish | undefined) => wish?.phase === 'sending' || wish?.phase === 'awaiting';

// The bridge still rings the device until it reports the alarm physically stopped or drained.
export function alarmRinging(timer: Timer): boolean {
  return typeof timer.ownerBootId === 'string' && !timer.physicalStopped && !timer.physicalDrained;
}

// »Timer · 10 min« above the title; the bridge's finished rows carry no duration, so then »Timer«.
export function alarmKicker(timer: Timer): string {
  const duration = timer.duration;
  return ['Timer', Number.isInteger(duration) && (duration ?? 0) > 0 ? timerDurationLabel(duration ?? 0) : '']
    .filter(Boolean)
    .join(' · ');
}

function AlarmView({
  timer,
  allowed,
  busy,
  notice,
  onStop,
  onClose,
}: {
  timer: Timer;
  allowed: boolean;
  busy: boolean;
  notice: string;
  onStop: () => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  // A new alarm (this view is keyed per timer) pulses for its first minute, never with reduced motion.
  const [pulse, setPulse] = useState(!reduced);
  useEffect(() => {
    const handle = setTimeout(() => {
      setPulse(false);
    }, PULSE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, []);
  const ringing = alarmRinging(timer);
  const label = ringing ? 'Stop alarm' : 'Færdig';
  const message = notice || (busy ? BUSY_TEXT : !allowed ? (ringing ? BLOCKED_NATIVE : BLOCKED) : '');
  return (
    <motion.div
      role="alertdialog"
      tabIndex={-1}
      aria-labelledby="timer-alert-name"
      ref={node => {
        // The stage stylesheet draws the open alarm from [open] (styles/kit.css »Timer-Alarm«).
        node?.setAttribute('open', '');
      }}
      id="timer-alert"
      className="timer-alert z-[1000]"
      aria-describedby="timer-alert-status"
      data-timer-id={timer.id}
      data-pulse={String(pulse && !reduced)}
      initial={reduced ? {opacity: 0} : {opacity: 0, transform: 'scale(0.94)'}}
      animate={reduced ? {opacity: 1} : {opacity: 1, transform: 'scale(1)'}}
      exit={reduced ? {opacity: 0} : {opacity: 0, transform: 'scale(0.98)'}}
      transition={reduced ? TRANSITION.reduced : {opacity: QUICK_FADE, transform: SNAPPY}}
    >
      <span className="notice-icon" aria-hidden="true">
        <img src={icon('timer')} alt="" />
      </span>
      <div className="notice-copy">
        <small id="timer-alert-kicker">{alarmKicker(timer)}</small>
        <span id="timer-alert-name">Timeren er færdig</span>
        <strong>0:00</strong>
      </div>
      <p id="timer-alert-status" role="status" hidden={!message}>
        {message}
      </p>
      <KitButton
        id="timer-alert-dismiss"
        className="timer-notice-close pv-kit pv-kit-button pv-btn"
        data-kit="button"
        data-kit-variant="primary"
        data-kit-size="88"
        data-kit-content="icon-label"
        data-kit-feedback="progress"
        aria-busy={busy && allowed ? true : undefined}
        isDisabled={!allowed}
        onPress={onStop}
      >
        <span
          className="--24 pv-kit pv-kit-icon pv-icon"
          data-kit="icon"
          aria-hidden="true"
          hidden={!ringing}
          style={{'--pv-icon-source': `url("${icon('stop-fill')}")`} as React.CSSProperties}
        />
        <span data-kit-slot="label">{label}</span>
      </KitButton>
      <KitButton
        id="timer-alert-open"
        className="timer-notice-open pv-kit pv-kit-button pv-btn"
        data-kit="button"
        data-kit-variant="secondary"
        onPress={onClose}
      >
        Luk visning
      </KitButton>
    </motion.div>
  );
}

// Mounted once by the shell, over everything (the coordinator places it in Shell).
export function TimerAlarm() {
  const {endpoint, read, timers, accessFor, wishFor} = useBridgeTimers();
  const send = useTimerCommands();
  // »Luk visning« per finished timer; a timer id is never reused, so the set only ever covers this page's alarms.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const status = read.data?.status;
  const epoch = status?.ok ? status.epoch : null;
  const finished = timers.filter(timer => timer.status === 'done');
  const timer = finished.find(item => !dismissed.has(item.id)) ?? null;
  const id = timer?.id ?? null;
  // The alarm's own timer: its wish and access (one wish per timer).
  const target = `id:${id ?? ''}`;
  const access = accessFor(target);
  const wish = wishFor(target);

  const allowed = access.canCancel === true && !!endpoint && !!epoch;
  const stop = () => {
    if (!timer || !endpoint || !epoch) return;
    send(endpoint.endpoint, epoch, {action: 'acknowledge_finished', timerId: timer.id});
  };
  const close = () => {
    if (id) setDismissed(previous => new Set([...previous, id]));
  };
  return (
    <AnimatePresence>
      {timer ? (
        <FocusScope key={timer.id} autoFocus restoreFocus>
          <AlarmView
            timer={timer}
            allowed={allowed}
            busy={waiting(wish)}
            notice={wishNotice(wish)}
            onStop={stop}
            onClose={close}
          />
        </FocusScope>
      ) : null}
    </AnimatePresence>
  );
}
