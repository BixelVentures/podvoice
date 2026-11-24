// Timer on HA: the PodVoice integration's timer bridge (pushed over podvoice/timer_subscribe; podvoice.timer_command_v2
// acts) for one of the endpoints the integration registered (panel config), one TimerCard per timer. The
// bridge owns the countdown and the page counts down between pushes. A tap is sent once; a read newer than its
// answer is its proof. Each timer has its own wish, so a tap on one card never shows on another.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
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
import type {Timer, TimerAccess, TimerEvent} from '../../screens/timer/model';
import {TimerCard} from '../../screens/timer/TimerCard';
import {timerDurationLabel} from '../../screens/timer/timer-model';
import {Button, Chip, Choices} from '../../ui';
import {useRoom} from '../room';
import {Notice, wishNotice} from '../ui';

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

export function TimersScreen() {
  const {endpoints, endpoint, choose, read, timers, accessFor, startWish} = useBridgeTimers();
  const send = useTimerCommands();
  const status = read.data?.status;
  const epoch = status?.ok ? status.epoch : null;
  const act = (request: TimerAction) => {
    if (endpoint && epoch) send(endpoint.endpoint, epoch, request);
  };
  const onCommand = (timer: Timer) => (event: TimerEvent & {now?: number}) => {
    if (event.type !== 'timer') return;
    if (event.action === 'cancel')
      act({action: timer.status === 'done' ? 'acknowledge_finished' : 'cancel', timerId: timer.id});
    else if (event.action === 'adjust' && timer.sourceRevision)
      act({action: 'adjust', timerId: timer.id, deltaSeconds: event.deltaSeconds, expectedRevision: timer.sourceRevision});
  };
  const recent = status?.ok ? status.recent : [];
  const unavailable = !endpoints.length
    ? 'PodVoice-integrationen har ingen timer-endepunkter. Timere kræver et PodVoice-endepunkt (Voice PE eller Talk).'
    : status && !status.ok
      ? `Timerne kan ikke læses: ${status.error}`
      : read.isError
        ? 'Timerne kunne ikke hentes fra Home Assistant.'
        : '';
  const start = (seconds: number, name: string) => {
    act({action: 'start', seconds, name});
  };
  return (
    <section
      id="timers-view"
      className="relative flex max-w-[744px] flex-[1_0_auto] flex-col gap-pv-s2 overflow-hidden"
      aria-labelledby="timers-title"
    >
      <header hidden>
        <h1 id="timers-title">Timer</h1>
        <p>{endpoint ? endpoint.name : 'Ingen timer-endepunkt'}</p>
      </header>
      {endpoints.length > 1 ? (
        <Choices
          aria-label="Endepunkt"
          className="mb-pv-s3 flex flex-wrap gap-pv-s1"
          value={endpoint?.endpoint ?? null}
          onChange={choose}
        >
          {endpoints.map(item => (
            <Chip key={item.endpoint} id={item.endpoint}>
              {item.name}
            </Chip>
          ))}
        </Choices>
      ) : null}
      {unavailable ? <p className="max-w-[36ch] text-pv-body leading-normal text-pv-ink-3">{unavailable}</p> : null}
      {/* A new timer's card arrives, a finished one leaves out of the flow, and what is below glides into place. */}
      <AnimatePresence initial={false} mode="popLayout">
        {timers.map(timer => (
          <TimerCard key={timer.id} timer={timer} access={accessFor(`id:${timer.id}`)} onCommand={onCommand(timer)} />
        ))}
      </AnimatePresence>
      <motion.section layout="position" className="mt-pv-s3 grid gap-pv-s2" aria-label="Start en timer"
        hidden={!epoch}>
        <h2 className="text-pv-label font-semibold tracking-[-0.02em]">Start en timer</h2>
        <div className="flex flex-wrap gap-pv-s2">
          {PRESETS.map(minutes => (
            <Button
              key={minutes}
              onPress={() => {
                start(minutes * 60, '');
              }}
            >
              {`${String(minutes)} min`}
            </Button>
          ))}
          {recent
            .filter(row => !PRESETS.some(minutes => minutes * 60 === row.seconds && !row.name))
            .slice(0, 4)
            .map(row => (
              <Button
                key={row.id}
                onPress={() => {
                  start(row.seconds, row.name);
                }}
              >
                {[row.name, timerDurationLabel(row.seconds)].filter(Boolean).join(' · ')}
              </Button>
            ))}
        </div>
        <Notice text={wishNotice(startWish)} />
      </motion.section>
    </section>
  );
}

// The Home shortcut's line: the running timer, else what can be done.
export function useTimerLine(): string {
  const {timers, endpoints} = useBridgeTimers();
  const current = timers[0];
  if (!endpoints.length) return 'Ingen timer-endepunkt';
  if (!current) return 'Start en timer';
  const time = `${String(Math.floor(current.remaining / 60))}:${String(current.remaining % 60).padStart(2, '0')}`;
  return current.status === 'done' ? `${current.name ?? 'Timer'} · Tiden er gået` : `${current.name ?? 'Timer'} · ${time}`;
}
