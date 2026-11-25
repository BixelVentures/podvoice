// The full-screen timer alarm over the panel (lærred »Timer-Alarm«): when the PodVoice
// integration's timer bridge reports a finished timer (podvoice.timer_status `finished`), the page is covered by the
// alarm with »Timeren er færdig«, and Stop acknowledges it once (podvoice.timer_command_v2 acknowledge_finished). It
// needs no add-on. The bridge's next read is the proof: the row leaves and the alarm goes. »Luk visning« only hides
// this view; it never claims to stop the alarm on the device. Not modal: React Aria's FocusScope
// owns focus (into Stop, back where it was) and the page under it is never made inert. Motion: in from .94 on the
// snappy spring with a quick fade, out as a quick fade (docs/MOTION.md P2); reduced: the fade only. A new alarm's
// dotted material pulses (opacity) for its first minute. Transform and opacity only.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useState} from 'react';
import {FocusScope} from 'react-aria';
import type {Wish} from '../lib/ha/commands';
import {useTimerCommands} from '../lib/ha/timers';
import {useNow} from '../lib/hooks/clock';
import {TRANSITION} from '../lib/motion/tokens';
import {Button, Glyph} from '../ui';
import type {Timer} from '../screens/timer/model';
import {clockTime} from '../screens/timer/presentation';
import {timerDurationLabel} from '../screens/timer/timer-model';
import {doneAt, useBridgeTimers} from './screens/Timers';
import {wishNotice} from './ui';

// The first pulse of a new alarm lasts a minute (timer-notice.js).
export const PULSE_MS = 60_000;
const BUSY_TEXT = 'Afventer timerens svar';
const BLOCKED_NATIVE = 'Alarmen kan ikke stoppes herfra lige nu. Luk visning stopper ikke alarmen.';
const BLOCKED = 'Timeren kan ikke afsluttes herfra lige nu.';

const waiting = (wish: Wish | undefined) => wish?.phase === 'sending' || wish?.phase === 'awaiting';

// The bridge still rings the device until it reports the alarm physically stopped or drained.
export function alarmRinging(timer: Timer): boolean {
  return typeof timer.ownerBootId === 'string' && !timer.physicalStopped && !timer.physicalDrained;
}

// Lærred »Timer-Alarm«: »Timer · 10 min · ringede 14.39« above the title. The duration comes from the start's own
// receipt (lib/ha/timers.ts bridgeTimers); »ringede« only once the device rang (physical_started), at the time this
// page first saw the timer finished.
export function alarmKicker(timer: Timer, rangAt: number | null = null): string {
  const duration = timer.duration;
  return ['Timer', Number.isInteger(duration) && (duration ?? 0) > 0 ? timerDurationLabel(duration ?? 0) : '',
    timer.alerted === true && rangAt !== null ? `ringede ${clockTime(rangAt)}` : '']
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
  onAdd,
  rangAt,
}: {
  timer: Timer;
  allowed: boolean;
  busy: boolean;
  notice: string;
  onStop: () => void;
  onClose: () => void;
  onAdd: () => void;
  rangAt: number;
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
  const label = ringing ? 'Stop' : 'Færdig';
  const message = notice || (busy ? BUSY_TEXT : !allowed ? (ringing ? BLOCKED_NATIVE : BLOCKED) : '');
  return (
    <motion.div
      role="alertdialog"
      tabIndex={-1}
      aria-labelledby="timer-alert-name"
      id="timer-alert"
      className="fixed inset-0 z-[1000] overflow-hidden bg-pv-ink text-center text-pv-on-dark outline-none touch-pan-y"
      aria-describedby="timer-alert-status"
      data-timer-id={timer.id}
      data-pulse={String(pulse && !reduced)}
      // In over 360 ms from 1.04 with a fade (Timer-Alarm), out as a quick fade.
      initial={reduced ? {opacity: 0} : {opacity: 0, scale: 1.04}}
      animate={reduced ? {opacity: 1} : {opacity: 1, scale: 1}}
      exit={{opacity: 0, transition: reduced ? TRANSITION.reduced : TRANSITION.fade}}
      transition={reduced ? TRANSITION.reduced : {duration: 0.36, ease: [0.2, 0.9, 0.3, 1]}}
    >
      <motion.span
        className="pointer-events-none absolute inset-0 bg-[url(/assets/timer/alarm-material.svg)]
          bg-[length:1180px_820px] bg-center bg-no-repeat"
        aria-hidden="true"
        initial={{opacity: 0.9}}
        animate={pulse && !reduced ? {opacity: [0.45, 1, 0.45]} : {opacity: 0.9}}
        transition={pulse && !reduced ? TRANSITION.ambient() : {duration: 0}}
      />
      <span
        className="pointer-events-none absolute inset-0
          bg-[radial-gradient(60%_70%_at_50%_46%,rgba(23,23,26,0.92)_30%,rgba(23,23,26,0.2)_100%)]"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 top-[150px] flex flex-col items-center gap-3 [overflow-wrap:anywhere]">
        <small id="timer-alert-kicker" className="text-[20px] leading-6 font-semibold text-pv-on-dark-3">
          {alarmKicker(timer, rangAt)}
        </small>
        <span
          id="timer-alert-name"
          className="text-[88px] leading-none font-[800] tracking-[-0.04em] text-pv-timer-accent"
        >
          Timeren er færdig
        </span>
        <strong className="mt-2 font-pv-mono text-[64px] leading-none font-medium tracking-[-0.04em]">0:00</strong>
      </div>
      <p
        id="timer-alert-status"
        className="absolute inset-x-0 top-[420px] mx-auto max-w-[640px] text-[18px] leading-[1.4] text-[#BDBBB5]"
        role="status"
        hidden={!message}
      >
        {message}
      </p>
      <div className="absolute inset-x-0 bottom-[120px] flex justify-center gap-4">
        <Button
          id="timer-alert-dismiss"
          variant="alarm"
          className="h-[88px] min-w-[280px] gap-3.5 px-10 text-[26px] leading-none font-[800]"
          busy={busy && allowed}
          isDisabled={!allowed}
          onPress={onStop}
        >
          {ringing ? <Glyph name="stop" size={28} /> : null}
          {label}
        </Button>
        {/* +1 min: the alarm is stopped and a one-minute timer with the same name starts, only once the stop was
            accepted (lib/ha/timers.ts restart); an unknown stop starts nothing. */}
        <Button
          id="timer-alert-add"
          variant="moerk"
          className="h-[88px] min-w-[200px] px-8 text-[24px] leading-none font-bold"
          aria-label="1 minut mere"
          isDisabled={!allowed}
          onPress={onAdd}
        >
          +1 min
        </Button>
      </div>
      <Button
        id="timer-alert-open"
        variant="quiet"
        className="absolute bottom-12 left-1/2 h-11 min-h-11 -translate-x-1/2 px-5 text-[16px] leading-none
          text-[#BDBBB5]"
        onPress={onClose}
      >
        Luk visning
      </Button>
    </motion.div>
  );
}

// Mounted once by the shell, over everything (the coordinator places it in Shell).
export function TimerAlarm() {
  const {endpoint, read, timers, accessFor, wishFor} = useBridgeTimers();
  const send = useTimerCommands();
  const now = useNow();
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
  const add = () => {
    if (!timer || !endpoint || !epoch) return;
    send(endpoint.endpoint, epoch, {action: 'restart', timerId: timer.id, seconds: 60,
      name: timer.name === 'Timer' ? '' : timer.name ?? ''});
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
            onAdd={add}
            rangAt={doneAt(timer, now)}
          />
        </FocusScope>
      ) : null}
    </AnimatePresence>
  );
}
