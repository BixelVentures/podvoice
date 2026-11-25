// Timer on HA: the PodVoice integration's timer bridge (pushed over podvoice/timer_subscribe; podvoice.timer_command_v2
// acts) for one of the endpoints the integration registered (panel config), one TimerFace (src/ui) per timer. The
// bridge owns the countdown and the page counts down between pushes. A tap is sent once; a read newer than its
// answer is its proof. Each timer has its own wish, so a tap on one card never shows on another.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import type {Ref} from 'react';
import {mergeRefs} from 'react-aria';
import {useStore} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import {
  bridgeTimers,
  nextTimerTick,
  panelEndpoints,
  settleTimerWishes,
  timerWishKey,
  timerWishPrefix,
  useTimerCommands,
  useTimerStatus,
} from '../../lib/ha/timers';
import type {TimerAction, TimerEndpoint, TimerRead} from '../../lib/ha/timers';
import {useCatalog, useLink, usePanelConfig} from '../../lib/ha/transport';
import {useNow, useRefreshAt} from '../../lib/hooks/clock';
import {useProgress} from '../../lib/motion/value';
import {TRANSITION} from '../../lib/motion/tokens';
import type {Timer, TimerAccess, TimerEvent} from '../../screens/timer/model';
import {adjustAllowed, cancelAllowed, cardActions, cardContent, clockTime, pageModel, recentChoices,
  timerPresentation} from '../../screens/timer/presentation';
import {adjustTimerDuration, timerDurationLabel, timerTime} from '../../screens/timer/timer-model';
import {Button, RecentTimers, Segment, TimerDraft, TimerFace} from '../../ui';
import type {WidgetState} from '../../ui';
import {useRoom} from '../room';
import {LastKnown, Notice, wishNotice} from '../ui';

const PRESETS = [3, 5, 10, 15];
const waiting = (wish: Wish | undefined) => wish?.phase === 'sending' || wish?.phase === 'awaiting';

// The cards stay tappable without a link to HA (they show the last known snapshot, dimmed): a tap then reports
// »Ikke sendt« instead of being swallowed by a disabled control.
export function timerAccess(read: TimerRead | undefined, wish: Wish | undefined): TimerAccess {
  const observed = read?.status.ok === true;
  const adjust = wish && waiting(wish) ? (wish.value as TimerAction) : null;
  return {
    connected: observed,
    canStart: observed,
    canCancel: observed,
    restartIds: [],
    pending: wish?.phase === 'sending',
    waiting: waiting(wish),
    // Never locked: a tap during a command is its own wish (last tap wins).
    awaitingObservation: false,
    allowIndependentCancel: true,
    cancelBlockedIds: [],
    canAdjust: observed,
    adjustBlockedIds: [],
    adjustPending:
      adjust?.action === 'adjust' ? {timerId: adjust.timerId, deltaSeconds: adjust.deltaSeconds} : null,
    feedback: wishNotice(wish),
  };
}

// The endpoint in the room (its HA device's area), else the first one.
function useEndpoint(endpoints: TimerEndpoint[]): [TimerEndpoint | null, (endpoint: string) => void] {
  const {room} = useRoom();
  const [chosen, setChosen] = useState<string | null>(null);
  const {deviceAreas} = useCatalog();
  const inRoom = endpoints.find(item => room && deviceAreas[item.device_id] === room.id);
  return [endpoints.find(item => item.endpoint === chosen) ?? inRoom ?? endpoints[0] ?? null, setChosen];
}

export function useBridgeTimers() {
  const endpoints = panelEndpoints(usePanelConfig());
  const [endpoint, choose] = useEndpoint(endpoints);
  const link = useLink();
  const read = useTimerStatus(endpoint?.endpoint ?? null, link.generation);
  const prefix = endpoint ? timerWishPrefix(endpoint.endpoint) : null;
  const wishes = useStore(
    commands.store,
    useShallow(state =>
      prefix ? Object.values(state.wishes).filter((item): item is Wish => !!item?.key.startsWith(prefix)) : [],
    ),
  );
  const wishOf = (target: string) =>
    endpoint ? wishes.find(item => item.key === timerWishKey(endpoint.endpoint, target)) : undefined;
  // Only a read newer than a command's answer shows its effect (the bridge acts before it answers); a push that
  // arrived while the call was on its way, or the wish turning »awaiting«, proves nothing.
  const answered = wishes.map(item => item.answeredAt).join();
  useEffect(() => {
    if (endpoint && read.dataUpdatedAt) settleTimerWishes(commands, endpoint.endpoint, read.dataUpdatedAt);
  }, [read.dataUpdatedAt, endpoint, answered]);
  // Count down between reads while a timer runs: the page's clock is read again at each whole second after the read.
  const now = useNow();
  useRefreshAt(nextTimerTick(read.data, now));
  const timers = bridgeTimers(read.data, now);
  const accessFor = (target: string) => timerAccess(read.data, wishOf(target));
  return {endpoints, endpoint, choose, read, timers, accessFor, wishFor: wishOf, startWish: wishOf('start')};
}

// When this page first saw each finished timer (the bridge's finished rows carry no time): »Timeren ringede 14.30«
// and the alarm's »ringede 14.39«. Timer ids are never reused.
const firstDone = new Map<string, number>();
export function doneAt(timer: Timer, now: number): number {
  const seen = firstDone.get(timer.id);
  if (seen !== undefined) return seen;
  firstDone.set(timer.id, now);
  return now;
}

const DRAFT_SECONDS = 300;

// One timer's face (A-Timer, Timer-pause, Timer-faerdig): ±1 min and Annuller while it runs, Annuller while it is
// paused (the bridge has no resume: DECISIONS »no invented pause«), Stop alarm and »Start igen · 10 min« when done.
function TimerPanel({timer, access, onCommand, now, ref}: {
  timer: Timer;
  access: TimerAccess;
  onCommand: (event: TimerEvent | {type: 'restart'; seconds: number}) => void;
  now: number;
  ref?: Ref<HTMLElement>;
}) {
  const done = timer.status === 'done';
  const alerted = timer.alerted === true;
  const completion = done ? {at: doneAt(timer, now), played: alerted, exhausted: false} : undefined;
  const content = cardContent(timer, 'detail', {live: true, completion});
  const actions = cardActions(timer, access, true);
  const [progress, panel] = useProgress<HTMLElement>(Number(content.progress), timer);
  const finishDisabled = !cancelAllowed(access) || access.cancelBlockedIds.includes(timer.id);
  const adjust = (deltaSeconds: number) => {
    if (adjustAllowed(timer, access, true, deltaSeconds))
      onCommand({type: 'timer', action: 'adjust', id: timer.id, deltaSeconds});
  };
  const duration = Number.isInteger(timer.duration) && (timer.duration ?? 0) > 0 ? timer.duration ?? 0 : null;
  const restart = done && duration !== null && !timer.stale;
  const tone = done ? 'faerdig' : timer.status === 'paused' ? 'pause' : 'koerer';
  // Lærred »Timer-faerdig«: the kicker is »Timeren ringede 14.30« once the device rang.
  const kicker = done && alerted && content.ringing ? `Timeren ringede ${clockTime(completion?.at ?? now)}`
    : content.kicker;
  return (
    <TimerFace
      ref={mergeRefs(panel, ref)}
      tone={tone}
      time={content.time}
      total={content.total}
      progress={content.progressKnown === 'true' || done ? progress : null}
      kicker={kicker}
      title={content.stateLabel}
      sub={content.state}
      long={content.long === 'true'}
      data-timer-id={content.timerId}
      data-status={content.status}
      aria-label={content.openLabel}
      aria-busy={access.waiting ? 'true' : undefined}
      actions={
        <>
          {!actions.hidden ? (
            <>
              {/* −/+ in the kit's stepper order, as on the draft's dial (G7): −1 min, then +1 min. */}
              <Button variant="moerk" size={56} aria-label="1 minut mindre" busy={actions.minus.loading}
                isDisabled={actions.minus.disabled} onPress={() => {
                  adjust(-60);
                }}>−1 min</Button>
              <Button variant="lys" size={56} aria-label="1 minut mere" busy={actions.plus.loading}
                isDisabled={actions.plus.disabled} onPress={() => {
                  adjust(60);
                }}>+1 min</Button>
            </>
          ) : null}
          <Button variant={done && content.ringing ? 'alarm' : 'moerk'} size={56}
            {...(content.ringing ? {icon: 'stop' as const} : {})}
            aria-label={content.finishAria} isDisabled={finishDisabled} onPress={() => {
              if (!finishDisabled) onCommand({type: 'timer', id: timer.id, action: 'cancel'});
            }}>{content.finishLabel}</Button>
          {restart ? (
            <Button variant="moerk" size={56} icon="restart" isDisabled={finishDisabled} onPress={() => {
              if (!finishDisabled) onCommand({type: 'restart', seconds: duration});
            }}>{`Start igen · ${timerDurationLabel(duration)}`}</Button>
          ) : null}
        </>
      }
      note={
        <>
          <TimerNote feedback={access.feedback} busy={access.waiting} />
          <LastKnown className="text-pv-on-dark-3" />
        </>
      }
    />
  );
}

// The card's one feedback line (an unknown or refused outcome).
function TimerNote({feedback, busy}: {feedback: string; busy: boolean}) {
  return (
    <p className="text-pv-meta text-pv-on-dark-2" role="status" hidden={!feedback} aria-busy={busy}>
      {feedback}
    </p>
  );
}

const MotionPanel = motion.create(TimerPanel);

export function TimersScreen() {
  const {endpoints, endpoint, choose, read, timers, accessFor, startWish} = useBridgeTimers();
  const send = useTimerCommands();
  const now = useNow();
  const [draft, setDraft] = useState(DRAFT_SECONDS);
  const status = read.data?.status;
  const epoch = status?.ok ? status.epoch : null;
  const act = (request: TimerAction) => {
    if (endpoint && epoch) send(endpoint.endpoint, epoch, request);
  };
  const onCommand = (timer: Timer) => (event: TimerEvent | {type: 'restart'; seconds: number}) => {
    if (event.type === 'restart') {
      act({action: 'restart', timerId: timer.id, seconds: event.seconds, name: timer.name === 'Timer' ? ''
        : timer.name ?? ''});
      return;
    }
    if (event.type !== 'timer') return;
    if (event.action === 'cancel')
      act({action: timer.status === 'done' ? 'acknowledge_finished' : 'cancel', timerId: timer.id});
    else if (event.action === 'adjust' && timer.sourceRevision)
      act({action: 'adjust', timerId: timer.id, deltaSeconds: event.deltaSeconds, expectedRevision: timer.sourceRevision});
  };
  const shown = timerPresentation(timers);
  const current = shown.current;
  // The current timer first (an unfinished alarm, then the one ending first); the others under it.
  const ordered = current ? [current, ...timers.filter(timer => timer.id !== current.id)] : [];
  const recent = recentChoices(status?.ok ? status.recent : []);
  const startAccess = accessFor('start');
  const page = pageModel({current, seconds: draft, access: startAccess, recent});
  const form = useRef<HTMLFormElement>(null);
  const unavailable = !endpoints.length
    ? 'PodVoice-integrationen har ingen timer-endepunkter. Timere kræver et PodVoice-endepunkt (Voice PE eller Talk).'
    : status && !status.ok
      ? `Timerne kan ikke læses: ${status.error}`
      : read.isError
        ? 'Timerne kunne ikke hentes fra Home Assistant.'
        : '';
  const fill = (seconds: number) => {
    if (current || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return;
    setDraft(seconds);
  };
  return (
    <section
      id="timers-view"
      className="relative flex flex-[1_0_auto] flex-col gap-4"
      aria-labelledby="timers-title"
    >
      <header hidden>
        <h1 id="timers-title">Timer</h1>
        <p>{endpoint ? endpoint.name : 'Ingen timer-endepunkt'}</p>
      </header>
      {endpoints.length > 1 ? (
        // Which endpoint's timers (Kit-Kontroller's segment).
        <Segment aria-label="Endepunkt" value={endpoint?.endpoint ?? null} onChange={choose}
          options={endpoints.map(item => ({id: item.endpoint, label: item.name}))} />
      ) : null}
      {unavailable ? <p className="max-w-[36ch] text-pv-body leading-normal text-pv-ink-3">{unavailable}</p> : null}
      {/* A new timer's face arrives, a finished one leaves out of the flow, and what is below glides into place. */}
      <AnimatePresence initial={false} mode="popLayout">
        {ordered.map(timer => (
          <MotionPanel key={timer.id} timer={timer} access={accessFor(`id:${timer.id}`)} onCommand={onCommand(timer)}
            now={now} layout="position" initial={{opacity: 0, scale: 0.96}} animate={{opacity: 1, scale: 1}}
            exit={{opacity: 0, scale: 0.96}} transition={{...TRANSITION.smooth, opacity: TRANSITION.fade}} />
        ))}
      </AnimatePresence>
      {epoch && !current ? (
        <TimerDraft
          ref={form}
          time={page.time}
          unit={page.unit}
          long={page.long === 'true'}
          presets={PRESETS.map(minutes => ({minutes, chosen: draft === minutes * 60, onPress: () => {
            fill(minutes * 60);
          }}))}
          onMinus={() => {
            fill(adjustTimerDuration(draft, -60));
          }}
          onPlus={() => {
            fill(adjustTimerDuration(draft, 60));
          }}
          onStart={() => {
            if (!page.startDisabled) act({action: 'start', seconds: draft, name: ''});
          }}
          minusDisabled={page.minusDisabled}
          plusDisabled={page.plusDisabled}
          draftDisabled={page.draftDisabled}
          startDisabled={page.startDisabled}
          busy={page.formBusy === true}
          note={<Notice text={wishNotice(startWish)} />}
        />
      ) : null}
      {epoch && !page.recentHidden ? (
        <RecentTimers choices={page.recent} isDisabled={page.recentWaiting} onChoose={seconds => {
          fill(seconds);
          // »Justér før start«: the draft comes into view.
          form.current?.scrollIntoView({block: 'nearest', behavior: 'instant'});
        }} />
      ) : null}
    </section>
  );
}

// The Home shortcut's line: the running timer, else what can be done.
export const RECENT_MS = 6 * 3600_000;
const clockOf = (seconds: number) => `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

// The Home widget's content (K-Widget timer): the first timer's count and state with its ring, else »Start en
// timer«.
export function useTimerWidget(): {state: WidgetState<'timer'>; prim: string; ctx: string; ring?: number;
  name?: string} {
  const {timers, endpoints, read} = useBridgeTimers();
  const now = useNow();
  const status = read.data?.status;
  const current = timerPresentation(timers).current ?? undefined;
  const last = status?.ok ? status.recent[0] : undefined;
  const at = last?.accepted_at;
  const until = at === undefined ? null : at * 1000 + RECENT_MS;
  // The line empties by itself when its six hours are up.
  useRefreshAt(until !== null && until > now ? until : null);
  if (!endpoints.length) return {state: 'startTom', prim: 'Start en timer', ctx: 'Ingen timer-endepunkt'};
  if (!current) {
    // »Senest brugt 5:00« for six hours after the last timer started here (K-Widget, besluttet 11. nov.), then an
    // empty line that keeps its height.
    return last && until !== null && now < until ? {state: 'start', prim: 'Start en timer', ctx: `Senest brugt ${timerTime(last.seconds)}`}
      : {state: 'startTom', prim: 'Start en timer', ctx: '\u00a0'};
  }
  const ring = current.duration ? Math.max(0, Math.min(1, current.remaining / current.duration)) : 1;
  if (current.status === 'done') {
    return {state: 'faerdig', prim: 'Tiden er gået', ctx: current.name ?? 'Timer', ring: 1};
  }
  return {state: current.status === 'paused' ? 'pause' : 'koerer', prim: clockOf(current.remaining),
    ctx: current.status === 'paused' ? 'På pause' : 'Tæller ned', ring,
    ...(current.name ? {name: current.name} : {})};
}
