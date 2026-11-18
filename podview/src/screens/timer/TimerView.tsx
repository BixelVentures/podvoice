// Timer: the controller the pre-React shell (widget-view.js) drives. It keeps the timer page's behaviour (access,
// start navigation, the display anchor that ticks native seconds, history) and renders through React into three
// containers, one root each: the timer page (#timers-view), the Home overview bar (#timer-card .timer-active-list)
// and the topbar chip (#header-timer). Every render is synchronous (flushSync), so the page is current when a call
// returns, as before. Cards are keyed by slot and timer id and never unmounted: a replaced timer's card stays as
// the same, hidden element. The finished-timer alarm (#timer-alert) is still timer-notice.js.
import type {MouseEvent, SyntheticEvent} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {applyKitComponent, applyKitTemplate} from '../../../ui/kit.js';
import {SPRING, showProgress, springCurve} from '../../../ui/motion.js';
import type {ProgressSource} from '../../../ui/motion.js';
import {
  adjustTimerDuration,
  readTimerDuration,
  timerAdjustmentBounds,
  timerDurationLabel,
  timerFinishLabel,
  timerProgress,
  timerStateLabel,
  timerTime,
  timersFor,
} from '../../../timer-model.js';
import {TimerNotice} from '../../../timer-notice.js';
import type {
  CardActions,
  CardContent,
  CardRestart,
  CardSlot,
  CardState,
  RecentChoice,
  Timer,
  TimerAccess,
  TimerPageModel,
  TimerScene,
} from './model';
import {timerPresentation} from './presentation';
import {TimerCard} from './TimerCard';
import type {CardHandlers} from './TimerCard';
import {HeaderTimerContent, TimerPage} from './TimerPage';
import type {PageHandlers} from './TimerPage';

export {timerPresentation};

const USER_PROGRESS_MS = springCurve(SPRING.smooth).ms;

interface LiveTimerRow {
  id: string;
  stale?: boolean;
  status?: string;
  secondsLeft?: number;
}

interface LiveSnapshot {
  bootId?: string;
  roomId?: string;
  timers?: {status?: string; epoch?: unknown; items?: LiveTimerRow[]};
}

export interface TimerHost {
  state?: TimerScene | undefined;
  live?: boolean;
  liveSnapshot?: LiveSnapshot | null;
  liveTransport?: {connected?: boolean; acceptedReadAt?: number; recoveryBlocked?: boolean} | null;
  liveStatus?: string;
  isConnected?: boolean;
  browserOffline?: boolean;
  motion?: unknown;
  dispatch: (event: Record<string, unknown>) => void;
  focusHeading?: () => void;
  renderResourceRail?: () => void;
  querySelector?: (selectors: string) => Element | null;
}

interface StartToken {
  sessionId: unknown;
  generation: unknown;
  bootId: string | undefined;
  roomId: string | undefined;
  epoch: unknown;
}

interface PresentationAnchor {
  key: string;
  status: string;
  sourceRemaining: number;
  at: number;
  displayed: number;
  advancing: boolean;
}

interface ProgressRecord {
  id: string;
  remaining: number;
  duration: number | null | undefined;
  status: string;
  at: number;
  result: ProgressSource;
}

interface PageState {
  runningLabel: string;
  runningHidden: boolean;
  formHidden: boolean;
  formBusy: boolean | undefined;
  recent: RecentChoice[];
  recentWaiting: boolean;
  recentHidden: boolean;
}

interface OverviewActivity {
  id: string;
  kind: 'timer';
  resource: Timer;
}

const NO_ACTIONS: CardActions = {
  hidden: true,
  toggle: {hidden: true, disabled: true, label: 'Pause'},
  plus: {hidden: true, disabled: true, loading: false},
  minus: {hidden: true, disabled: true, loading: false},
};
const NO_RESTART: CardRestart = {hidden: true, disabled: true, label: ''};

const clockTime = (at: number) =>
  new Date(at).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'}).replace(':', '.');

const finite = (value: unknown): value is number => Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);

function part<T extends Element>(node: ParentNode, selector: string, type: abstract new () => T): T {
  const found = node.querySelector(selector);
  if (!(found instanceof type)) throw Error(`Timer screen is missing ${selector}`);
  return found;
}

export class TimerView {
  host: TimerHost;
  detail: HTMLElement;
  overview: HTMLElement;
  overviewList: HTMLElement;
  shortcut: HTMLElement;
  form: HTMLFormElement;
  inputs: HTMLFormControlsCollection;
  duration: number | null = 300;
  connected = true;
  canStart: boolean | undefined;
  canCancel: boolean | undefined;
  canDraft: boolean | undefined;
  accessModel: Partial<TimerAccess> | undefined;
  currentTimer: Timer | null | undefined;
  // The rendered cards by `${slot}:${timer id}`.
  nodes = new Map<string, HTMLElement>();
  notice: TimerNotice | null | undefined;
  headerTimer: HTMLButtonElement | null;
  startNavigation: StartToken | null = null;
  presentationAnchor: PresentationAnchor | null = null;
  presentationTick: ReturnType<typeof setTimeout> | null = null;
  presentationNow: (() => number) | undefined;
  history: string | undefined;
  overviewActivities: OverviewActivity[] | undefined;
  overviewSelectedId: string | null | undefined;
  activityAnimation: Animation | null | undefined;
  activityPointer: {target: HTMLElement} | null | undefined;

  private readonly note: HTMLElement;
  private readonly cards = new Map<string, CardState>();
  private readonly order: Record<CardSlot, string[]> = {overview: [], detail: []};
  private readonly progressSeen = new Map<string, ProgressRecord>();
  private readonly detailRoot: Root;
  private readonly overviewRoot: Root;
  private headerRoot: Root | null = null;
  private page: PageState = {
    runningLabel: 'Aktuel timer',
    runningHidden: false,
    formHidden: false,
    formBusy: undefined,
    recent: [],
    recentWaiting: false,
    recentHidden: true,
  };

  private readonly cardHandlers: CardHandlers = {
    register: (key, node) => {
      if (node) this.nodes.set(key, node);
    },
    open: () => {
      this.host.dispatch({type: 'show', id: 'timers'});
      this.host.focusHeading?.();
    },
    timerAction: (id, event) => {
      this.timerAction(id, event.currentTarget);
    },
    finish: id => {
      if (!this.canCancel || this.accessModel?.cancelBlockedIds?.includes(id)) return;
      this.host.dispatch({type: 'timer', id, action: 'cancel'});
      this.host.focusHeading?.();
    },
    restart: (id, event) => {
      const button = event.currentTarget;
      if (button.disabled || button.hidden) return;
      this.host.dispatch({type: 'timer', id, action: 'restart', now: Date.now()});
    },
  };

  private readonly pageHandlers: PageHandlers = {
    input: () => {
      this.duration = readTimerDuration(this.field('hours'), this.field('minutes'), this.field('seconds'));
      this.updatePicker();
    },
    submit: (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      this.submit();
    },
    preset: minutes => {
      this.fill({seconds: minutes * 60});
    },
    step: delta => {
      this.fill({seconds: adjustTimerDuration(this.duration ?? 300, delta)});
    },
    recent: (seconds: number, event: MouseEvent<HTMLButtonElement>) => {
      if (event.currentTarget.disabled) return;
      this.fill({seconds});
      this.form.scrollIntoView({block: 'nearest', behavior: 'instant'});
      const target = part(this.form, '.timer-start', HTMLButtonElement);
      if (!target.disabled) target.focus({preventScroll: true});
      else this.form.querySelector<HTMLElement>('h2')?.focus({preventScroll: true});
    },
  };

  constructor(host: TimerHost, detail: HTMLElement, overview: HTMLElement) {
    this.host = host;
    this.detail = detail;
    this.overview = overview;
    if (overview.dataset.kitTone !== 'dark') overview.dataset.kitTone = 'dark';
    applyKitTemplate(detail, 'detail');
    this.overviewList = part(overview, '.timer-active-list', HTMLElement);
    this.shortcut = part(overview, '#open-timers', HTMLElement);
    const doc = detail.ownerDocument;
    // The one feedback slot follows the visible timer surface (draft or detail card) as the same element.
    this.note = doc.createElement('p');
    this.note.id = 'timers-live-note';
    this.note.setAttribute('role', 'status');
    this.note.hidden = true;
    detail.replaceChildren();
    this.detailRoot = createRoot(detail);
    this.overviewList.replaceChildren();
    this.overviewRoot = createRoot(this.overviewList);
    this.paint('detail');
    part(detail, ':scope > .response-heading', HTMLElement).after(this.note);
    this.form = part(detail, 'form', HTMLFormElement);
    this.inputs = this.form.elements;
    this.notice = new TimerNotice(host, doc.getElementById('timer-alert'), {
      onElapsed: () => {
        this.host.dispatch({type: 'show', id: 'now'});
        this.render(this.host.state ?? {});
        this.renderOverviewActivities(this.host.state ?? {});
      },
    });
    this.updatePicker();
    this.headerTimer = this.createHeaderTimer();
  }

  // Lærred »A-Topbar«: a running timer is a chip in the topbar on every page but Timer. A tap opens Timer.
  createHeaderTimer(): HTMLButtonElement | null {
    const context = this.host.querySelector?.('.view-nav .header-context');
    if (!context) return null;
    const chip = context.ownerDocument.createElement('button');
    chip.type = 'button';
    chip.id = 'header-timer';
    chip.className = 'header-timer';
    chip.hidden = true;
    chip.addEventListener('click', () => {
      this.host.dispatch({type: 'show', id: 'timers'});
      this.host.focusHeading?.();
    });
    context.insertBefore(chip, context.querySelector('#header-weather') ?? context.firstChild);
    this.headerRoot = createRoot(chip);
    this.paintHeader(null);
    return chip;
  }

  renderHeaderTimer(s: TimerScene | undefined = this.host.state) {
    const chip = this.headerTimer;
    if (!chip || !s) return;
    const current = timerPresentation(timersFor(s).filter(t => !t.hidden)).current;
    const shown = !!current && ['running', 'paused'].includes(current.status) && !current.stale && s.focus !== 'timers';
    if (chip.hidden !== !shown) chip.hidden = !shown;
    if (!shown) return;
    const t = this.presentationTimer(current);
    const time = timerTime(t.remaining);
    const label = `Timer ${time}, ${timerStateLabel(t)}`;
    this.paintHeader(time);
    if (chip.getAttribute('aria-label') !== label) chip.setAttribute('aria-label', label);
    showProgress(chip, '--progress', String(timerProgress(t) ?? 100), this.progressSource('header', t));
  }

  // P5 progress (docs/MOTION.md §3.6): a running timer that counted down by about the time that passed is a tick and
  // runs linear over the second; any other change of the same timer (+1 min, Start igen) is the user's and travels
  // on the smooth spring; a new timer is drawn in place.
  progressSource(key: string, t: Timer): ProgressSource {
    const last = this.progressSeen.get(key);
    const now = Date.now();
    const same =
      last?.id === t.id &&
      last.remaining === t.remaining &&
      last.duration === t.duration &&
      last.status === t.status;
    if (same) return last.result;
    let result: ProgressSource = {source: 'none'};
    if (last?.id === t.id) {
      const step = last.remaining - t.remaining;
      const elapsed = (now - last.at) / 1000;
      const tick =
        t.status === 'running' &&
        last.status === 'running' &&
        last.duration === t.duration &&
        step > 0 &&
        step <= elapsed + 1.5;
      // A tick inside a user change's spring stays on the spring, so the ring does not switch curves mid-travel.
      const travelling = last.result.source === 'user' && now - last.at < USER_PROGRESS_MS;
      result = tick && !travelling ? {source: 'tick', interval: 1000} : {source: 'user'};
    }
    this.progressSeen.set(key, {id: t.id, remaining: t.remaining, duration: t.duration, status: t.status, at: now,
      result});
    return result;
  }

  completeStartNavigation(token: StartToken | null | undefined, timerId?: string) {
    if (!token || this.startNavigation !== token) return;
    this.startNavigation = null;
    const host = this.host;
    const s = host.state ?? {};
    const snapshot = host.liveSnapshot;
    if (
      host.isConnected === false ||
      s.focus !== 'timers' ||
      s.sessionId !== token.sessionId ||
      s.generation !== token.generation ||
      (host.live && (snapshot?.bootId !== token.bootId || snapshot?.roomId !== token.roomId))
    )
      return;
    if (host.live) {
      const timers = snapshot?.timers;
      const current = timers?.items?.find(row => row.id === timerId);
      if (
        timers?.status !== 'observed' ||
        timers.epoch !== token.epoch ||
        !current ||
        current.stale ||
        !['running', 'paused'].includes(current.status ?? '')
      )
        return;
    }
    host.dispatch({type: 'show', id: 'now'});
    host.focusHeading?.();
  }

  fill({seconds}: {seconds: number}) {
    if (this.currentTimer || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return;
    this.duration = seconds;
    this.input('hours').value = String(Math.floor(seconds / 3600));
    this.input('minutes').value = String(Math.floor((seconds % 3600) / 60));
    this.input('seconds').value = String(seconds % 60);
    this.updatePicker();
  }

  updatePicker() {
    this.paint('detail');
  }

  // This is a display anchor, never a native deadline, completion or grant.
  // Repeated SSE copies of the same cached source count retain its original anchor.
  presentationTimer(t: Timer): Timer {
    const stop = () => {
      clearTimeout(this.presentationTick ?? undefined);
      this.presentationTick = null;
    };
    const host = this.host;
    const s = host.liveSnapshot;
    const transport = host.liveTransport;
    if (
      !host.live ||
      !t.ownerBootId ||
      s?.bootId !== t.ownerBootId ||
      typeof s.roomId !== 'string' ||
      s.timers?.epoch === undefined ||
      s.timers.epoch === null ||
      !Number.isFinite(t.remaining) ||
      t.remaining < 0
    ) {
      stop();
      this.presentationAnchor = null;
      return t;
    }
    const timers = s.timers;
    const now = this.presentationNow?.() ?? globalThis.performance.now();
    const key = JSON.stringify([s.bootId, s.roomId, timers.epoch, t.id]);
    let anchor = this.presentationAnchor;
    if (anchor?.key !== key || anchor.status !== t.status || anchor.sourceRemaining !== t.remaining) {
      stop();
      anchor = this.presentationAnchor = {key, status: t.status, sourceRemaining: t.remaining, at: now,
        displayed: t.remaining, advancing: false};
    }
    const item = timers.items?.find(row => row.id === t.id);
    const sourceCurrent = timers.status === 'observed' && item?.status === t.status && item.secondsLeft === t.remaining;
    const readAt = transport?.acceptedReadAt;
    const age = Date.now() - (readAt ?? NaN);
    const ready =
      host.isConnected !== false &&
      host.browserOffline !== true &&
      host.liveStatus === 'connected' &&
      transport?.connected === true &&
      transport.recoveryBlocked !== true &&
      Number.isFinite(readAt) &&
      age >= 0 &&
      age < 6000 &&
      this.connected &&
      !t.stale &&
      sourceCurrent &&
      t.status === 'running';
    if (!ready) {
      stop();
      anchor.advancing = false;
      return anchor.displayed === t.remaining ? t : {...t, remaining: anchor.displayed};
    }
    if (!anchor.advancing) {
      anchor.at = now;
      anchor.displayed = t.remaining;
      anchor.advancing = true;
    }
    const elapsed = Math.max(0, now - anchor.at);
    anchor.displayed = Math.max(0, Math.ceil(anchor.sourceRemaining - elapsed / 1000));
    if (anchor.displayed > 0 && !this.presentationTick) {
      const delay = Math.max(1, Math.ceil(1000 - (elapsed % 1000)));
      this.presentationTick = setTimeout(() => {
        this.presentationTick = null;
        if (host.isConnected === false) {
          this.presentationAnchor = null;
          return;
        }
        const current = timerPresentation(timersFor(host.state ?? {})).current;
        if (!current) {
          this.presentationAnchor = null;
          return;
        }
        for (const slot of ['overview', 'detail']) {
          const card = this.nodes.get(`${slot}:${current.id}`);
          if (card && !card.hidden) this.card(current, card.parentNode, `${slot}:${current.id}`);
        }
        this.renderHeaderTimer();
        host.renderResourceRail?.();
      }, delay);
    } else if (anchor.displayed === 0) stop();
    return anchor.displayed === t.remaining ? t : {...t, remaining: anchor.displayed};
  }

  // Draws one card (`overview:<id>` or `detail:<id>`) for the timer and returns its element.
  card(timer: Timer, _container?: unknown, key = `detail:${timer.id}`): HTMLElement | undefined {
    const t = this.presentationTimer(timer);
    const slot: CardSlot = key.startsWith('overview:') ? 'overview' : 'detail';
    const previous = this.cards.get(key);
    this.cards.set(key, {
      key,
      slot,
      id: t.id,
      hidden: false,
      content: this.cardContent(t, key),
      actions: slot === 'detail' ? this.timerActions(t) : NO_ACTIONS,
      restart: slot === 'detail' ? this.restartState(t) : NO_RESTART,
      busy: previous?.busy,
      finishDisabled: previous?.finishDisabled ?? false,
    });
    if (!previous) this.order[slot].push(key);
    this.paint(slot);
    return this.nodes.get(key);
  }

  private cardContent(t: Timer, key: string): CardContent {
    const progress = timerProgress(t);
    const detail = key.startsWith('detail:');
    const time = t.status === 'done' ? (detail ? '0:00' : 'Tiden er gået') : timerTime(t.remaining);
    // Lærred »A-Timer«: the known total under the time (»af 10:00«), only on the timer page.
    const duration = integer(t.duration) && t.duration > 0 ? t.duration : null;
    const total = detail && duration !== null ? `af ${timerTime(duration)}` : '';
    // The detail title is the product's state label (»Tæller ned«, »På pause«).
    const stateLabel = detail ? timerStateLabel(t) : '';
    const completion = this.notice?.completions.get(t.id);
    const completedNote =
      t.status === 'done' && completion?.exhausted
        ? `${completion.played ? 'Timeren ringede' : 'Timeren blev færdig'} kl. ${clockTime(completion.at)}`
        : '';
    const clock = finite(t.deadline) ? clockTime(t.deadline) : '';
    const running = t.status === 'running' && !t.stale && clock;
    // Detail (lærred »A-Timer«/»Timer-pause«/»Timer-faerdig«): kicker, the state as title, one plain line under it.
    // Ringing: the native alarm (timerFinishLabel), or in the local preview the bell inside its own five-minute window.
    const localRinging =
      this.host.live !== true && !t.ownerBootId && t.status === 'done' && !!completion && !completion.exhausted;
    const ringing = t.status === 'done' && (timerFinishLabel(t) === 'Stop alarm' || localRinging);
    // Lærred »Timer-faerdig«: »Timeren ringede 14.30« from the real finish time (the bell's record, else the deadline).
    const rangAt = Number.isFinite(completion?.at) ? completion?.at : t.deadline;
    const rang = ringing && finite(rangAt) ? `Timeren ringede ${clockTime(rangAt)}` : '';
    const kicker = !detail
      ? t.status === 'done'
        ? ''
        : 'Timer'
      : t.stale
        ? 'Timer'
        : t.status === 'paused'
          ? 'Timer på pause'
          : t.status === 'done' && completedNote
            ? completedNote
            : t.status === 'done' && rang
              ? rang
              : duration !== null
                ? `Timer · ${timerDurationLabel(duration)}`
                : 'Timer';
    const rawStatus =
      detail && !t.stale
        ? running
          ? `Færdig kl. ${clock}`
          : t.status === 'paused'
            ? 'Ringen står stille, til du fortsætter.'
            : t.status === 'done'
              ? ringing
                ? 'Alarmen ringer, til du stopper den.'
                : ''
              : timerStateLabel(t)
        : completedNote || t.displayState || (t.stale || !running ? timerStateLabel(t) : `Slutter ${clock}`);
    const state = rawStatus === time ? '' : rawStatus;
    const openLabel = ['Timer', t.status === 'done' ? 'Tiden er gået' : time, state, detail ? '' : 'Åbn timerdetaljer']
      .filter(Boolean)
      .join(' · ');
    const finishLabel = ringing ? 'Stop alarm' : timerFinishLabel(t);
    return {
      timerId: t.id,
      status: t.status,
      stale: String(t.stale === true),
      progressKnown: String(progress !== null),
      progress: String(progress ?? 0),
      progressSource: this.progressSource(key, t),
      total,
      time,
      long: String(t.remaining >= 3600),
      stateLabel,
      kicker,
      state,
      repeat: String(!!stateLabel && state === stateLabel),
      openLabel,
      finishLabel,
      finishAria: `${finishLabel} timer`,
      ringing,
    };
  }

  // Lærred »Timer-faerdig«: »Start igen · 10 min« beside »Stop alarm«, only with a known duration.
  private restartState(t: Timer | null): CardRestart {
    const access = this.accessModel;
    const duration = t?.duration;
    const known =
      t?.status === 'done' && !t.stale && integer(duration) && duration >= 1 && duration <= 86400;
    const allowed =
      this.host.live === true ? !!t?.ownerBootId && access?.restartIds?.includes(t.id) === true : !t?.ownerBootId;
    const hidden = !known || !allowed;
    const label = known && integer(duration) ? `Start igen · ${timerDurationLabel(duration)}` : '';
    const disabled = hidden || !this.connected || !!access?.pending || !!access?.awaitingObservation;
    return {hidden, disabled, label};
  }

  private timerActions(t: Timer | null): CardActions {
    const access = this.accessModel;
    const pending = t && access?.adjustPending?.timerId === t.id ? access.adjustPending : null;
    const bounds = timerAdjustmentBounds(t);
    const local = this.host.live !== true && !t?.ownerBootId && ['running', 'paused'].includes(t?.status ?? '');
    const native =
      this.host.live === true && !!t?.ownerBootId && ((!!bounds && access?.canAdjust === true) || !!pending);
    const blocked = !!access?.pending || !!access?.awaitingObservation || !!access?.adjustPending;
    const adjust = (delta: number) => {
      // An adjustment in flight for this timer keeps +1/−1 tappable; the host queues the taps (T1).
      const disabled =
        !native ||
        !this.connected ||
        access?.canAdjust !== true ||
        (blocked && !pending) ||
        !!access.adjustBlockedIds?.includes(t.id) ||
        !bounds?.[delta < 0 ? 'minus' : 'plus'];
      return {
        hidden: !native,
        disabled,
        loading: !disabled && !!(pending?.deltaSeconds === delta && access.waiting),
      };
    };
    const label = t?.status === 'paused' ? 'Fortsæt' : 'Pause';
    return {
      hidden: !local && !native,
      toggle: {hidden: !local, disabled: !local || !this.connected || blocked || !!t?.stale, label},
      plus: adjust(60),
      minus: adjust(-60),
    };
  }

  private timerAction(id: string, button: HTMLButtonElement) {
    const timer = timersFor(this.host.state ?? {}).find(t => t.id === id);
    if (button.disabled || button.hidden || !this.connected || !timer) return;
    if (button.dataset.timerAction === 'adjust') {
      const deltaSeconds = Number(button.dataset.deltaSeconds);
      const access = this.accessModel;
      const bounds = timerAdjustmentBounds(this.presentationTimer(timer));
      if (
        this.host.live !== true ||
        !timer.ownerBootId ||
        access?.canAdjust !== true ||
        ((access.pending || access.awaitingObservation || access.adjustPending) &&
          access.adjustPending?.timerId !== timer.id) ||
        access.adjustBlockedIds?.includes(timer.id) ||
        !bounds ||
        ![-60, 60].includes(deltaSeconds) ||
        !bounds[deltaSeconds < 0 ? 'minus' : 'plus']
      )
        return;
      this.host.dispatch({type: 'timer', action: 'adjust', id: timer.id, deltaSeconds});
      return;
    }
    if (this.host.live || timer.ownerBootId || timer.stale || !['running', 'paused'].includes(timer.status)) return;
    this.host.dispatch({type: 'timer', id: timer.id, action: timer.status === 'paused' ? 'resume' : 'pause',
      now: Date.now()});
  }

  private submit() {
    if (!this.connected || this.duration === null || !this.canStart) return;
    const host = this.host;
    const state = host.state ?? {};
    const before = state.timer;
    const token: StartToken = {
      sessionId: state.sessionId,
      generation: state.generation,
      bootId: host.liveSnapshot?.bootId,
      roomId: host.liveSnapshot?.roomId,
      epoch: host.liveSnapshot?.timers?.epoch,
    };
    this.startNavigation = state.focus === 'timers' ? token : null;
    host.dispatch({type: 'timer-start', seconds: this.duration, name: '', now: Date.now()});
    if (host.live) return;
    const current = host.state?.timer;
    if (current && current !== before && current.status === 'running' && !current.stale)
      this.completeStartNavigation(token);
    else this.startNavigation = null;
  }

  renderAccess({
    connected,
    canStart = connected,
    canCancel = connected,
    restartIds = [],
    pending = false,
    waiting = pending,
    awaitingObservation = false,
    allowIndependentCancel = false,
    cancelBlockedIds = [],
    canAdjust = false,
    adjustBlockedIds = [],
    adjustPending = null,
    feedback = '',
  }: Partial<TimerAccess> = {}) {
    this.accessModel = {connected, canStart, canCancel, restartIds, pending, waiting, awaitingObservation,
      allowIndependentCancel, cancelBlockedIds, canAdjust, adjustBlockedIds, adjustPending, feedback};
    const blocked = pending || awaitingObservation;
    this.connected = connected === true;
    this.canStart = this.connected && canStart === true && !this.currentTimer && !blocked;
    this.canCancel =
      this.connected &&
      canCancel === true &&
      (!pending || allowIndependentCancel) &&
      (!awaitingObservation || allowIndependentCancel);
    if (this.host.live && !this.connected) {
      clearTimeout(this.presentationTick ?? undefined);
      this.presentationTick = null;
      if (this.presentationAnchor) this.presentationAnchor.advancing = false;
    }
    // Visibility belongs to timer content, never to controller authority. A
    // disabled draft is still the same draft; it is not an observed timer.
    this.canDraft = this.connected && !blocked && !this.currentTimer;
    const busy = String(waiting);
    this.page = {...this.page, formHidden: !!this.currentTimer, formBusy: waiting};
    for (const [key, card] of this.cards) {
      const finishDisabled = !this.canCancel || cancelBlockedIds.includes(card.id);
      let next: CardState = {...card, busy: waiting, finishDisabled};
      if (card.slot === 'detail') {
        const timer = timersFor(this.host.state ?? {}).find(t => t.id === card.id);
        const t = timer ? this.presentationTimer(timer) : null;
        next = {...next, actions: this.timerActions(t), restart: this.restartState(t)};
      }
      this.cards.set(key, next);
    }
    this.paint('overview');
    this.paint('detail');
    if (this.notice && this.host.state) this.renderNotice();
    const note = this.note;
    const feedbackOwner = this.currentTimer ? this.nodes.get(`detail:${this.currentTimer.id}`) : this.form;
    applyKitComponent(note, 'listrow', {variant: 'feedback'});
    if (note.getAttribute('data-kit-text') !== 'meta') note.setAttribute('data-kit-text', 'meta');
    if (note.dataset.kitSlot !== 'feedback') note.dataset.kitSlot = 'feedback';
    if (feedbackOwner && !feedbackOwner.hidden && note.parentNode !== feedbackOwner) feedbackOwner.append(note);
    if (note.hidden !== !feedback) note.hidden = !feedback;
    if (note.textContent !== feedback) note.textContent = feedback;
    if (note.getAttribute('aria-busy') !== busy) note.setAttribute('aria-busy', busy);
  }

  render(s: TimerScene) {
    if (s.focus !== 'timers') this.startNavigation = null;
    const projection = timerPresentation(timersFor(s));
    const current = projection.current;
    for (const [key, card] of this.cards) {
      const hidden = key !== `overview:${String(current?.id)}` && key !== `detail:${String(current?.id)}`;
      if (card.hidden !== hidden) this.cards.set(key, {...card, hidden});
    }
    if (this.overviewList.hidden !== !current) this.overviewList.hidden = !current;
    if (this.shortcut.hidden !== !!current) this.shortcut.hidden = !!current;
    this.currentTimer = current;
    if (!current) {
      clearTimeout(this.presentationTick ?? undefined);
      this.presentationTick = null;
      this.presentationAnchor = null;
    }
    if (current) {
      for (const slot of ['overview', 'detail'] as const) {
        const key = `${slot}:${current.id}`;
        this.card(current, null, key);
        const order = this.order[slot];
        if (order[0] !== key) {
          this.order[slot] = [key, ...order.filter(row => row !== key)];
          this.paint(slot);
        }
      }
    }
    this.page = {
      ...this.page,
      runningLabel: current?.stale
        ? 'Senest kendte timer'
        : current?.status === 'done'
          ? 'Afsluttet timer'
          : current?.status === 'paused'
            ? 'Timer på pause'
            : 'Aktuel timer',
      runningHidden: !current,
    };
    const detailHidden = s.focus !== 'timers';
    if (this.detail.hidden !== detailHidden) this.detail.hidden = detailHidden;
    const blocked = {connected: false, canStart: false, canCancel: false};
    this.renderAccess(this.host.live ? (this.accessModel ?? blocked) : {connected: s.connected});
    this.renderHeaderTimer(s);
    const demoStart = this.detail.ownerDocument.getElementById('start-timer') as HTMLButtonElement | null;
    if (demoStart && demoStart.disabled !== !this.canStart) demoStart.disabled = !this.canStart;
    this.renderRecent(s, current);
  }

  // Lærred »A-Timer« »Tidligere timere«: only the product's own timer history, newest first, five unique durations.
  // A tap fills the new-timer draft (»Justér før start«); while a timer runs the history waits. No history: no card.
  renderRecent(s: TimerScene, current: Timer | null) {
    const history = (Array.isArray(s.timerHistory) ? (s.timerHistory as unknown[]) : []).filter(
      (item): item is {seconds: number} => {
        const seconds = (item as {seconds?: unknown} | null)?.seconds;
        return Number.isInteger(seconds) && (seconds as number) >= 1 && (seconds as number) <= 86400;
      },
    );
    const unique: {seconds: number}[] = [];
    for (const item of history) {
      if (!unique.some(row => row.seconds === item.seconds)) unique.push(item);
      if (unique.length === 5) break;
    }
    const signature = JSON.stringify(unique.map(item => item.seconds));
    let recent = this.page.recent;
    if (signature !== this.history) {
      this.history = signature;
      recent = unique.map((item, index) => ({
        seconds: item.seconds,
        time: timerTime(item.seconds),
        label: index === 0 ? 'Seneste' : 'Tidligere',
      }));
    }
    const recentWaiting = !!current || !this.connected;
    const recentHidden = !unique.length;
    const page = this.page;
    if (page.recent === recent && page.recentWaiting === recentWaiting && page.recentHidden === recentHidden) return;
    this.page = {...page, recent, recentWaiting, recentHidden};
    this.paint('detail');
  }

  renderOverviewActivities(s: TimerScene) {
    // The top overview slot belongs only to Timer. Other resources keep their fixed cards.
    const current = timerPresentation(timersFor(s).filter(timer => !timer.hidden)).current;
    if (!current) {
      clearTimeout(this.presentationTick ?? undefined);
      this.presentationTick = null;
      this.presentationAnchor = null;
    }
    const selected: OverviewActivity | null = current
      ? {id: `timer:${current.id}`, kind: 'timer', resource: current}
      : null;
    this.overviewActivities = selected ? [selected] : [];
    this.overviewSelectedId = selected?.id ?? null;
    if (this.overviewList.hidden !== !selected) this.overviewList.hidden = !selected;
    if (this.shortcut.hidden !== !!selected) this.shortcut.hidden = !!selected;
    let changed = false;
    for (const [key, card] of this.cards) {
      if (card.slot !== 'overview') continue;
      const hidden = key !== `overview:${current?.id ?? ''}`;
      if (card.hidden !== hidden) {
        this.cards.set(key, {...card, hidden});
        changed = true;
      }
    }
    if (current) {
      const key = `overview:${current.id}`;
      this.card(current, this.overviewList, key);
      const card = this.cards.get(key);
      const disabled = !this.canCancel || !!this.accessModel?.cancelBlockedIds?.includes(current.id);
      if (card && card.finishDisabled !== disabled) {
        this.cards.set(key, {...card, finishDisabled: disabled});
        this.paint('overview');
      }
    } else if (changed) this.paint('overview');
    const activityKind = selected ? 'timer' : 'empty';
    if (this.overview.dataset.activityKind !== activityKind) this.overview.dataset.activityKind = activityKind;
    // SceneMotion owns the outer timer/grid transition. A second entrance on
    // these children would add displacement and could outlive hidden navigation.
    const shownId = selected?.id ?? 'empty';
    if (this.overview.dataset.activityId !== shownId) {
      this.overview.dataset.activityId = shownId;
      this.activityAnimation?.cancel();
      this.activityAnimation = null;
    }
  }

  renderNotice(
    focus = this.host.state?.focus,
    live = this.host.live,
    feedbackVisible = this.detail.ownerDocument.getElementById('playback-status')?.hidden === false,
  ) {
    const notice = this.notice;
    if (!notice) return;
    const timer =
      timersFor(this.host.state ?? {}).find(t => t.status === 'done' && !t.stale && !t.noticeDismissed) ??
      this.currentTimer;
    const before = timer && notice.completions.get(timer.id);
    notice.render(timer, focus, live, feedbackVisible, null, {...this.accessModel, canCancel: this.canCancel});
    // The bell's record is what makes a local finished timer ring; its detail card reads it, so refresh it once.
    const detail = timer && this.nodes.get(`detail:${timer.id}`);
    if (detail && !before && notice.completions.get(timer.id) && this.currentTimer?.id === timer.id)
      this.card(this.currentTimer, detail.parentNode, `detail:${timer.id}`);
  }

  cleanup() {
    clearTimeout(this.presentationTick ?? undefined);
    this.presentationTick = null;
    this.presentationAnchor = null;
    this.startNavigation = null;
    this.activityAnimation?.cancel();
    if (this.activityPointer) this.activityPointer.target.style.transform = '';
    this.activityPointer = null;
    this.notice?.cleanup();
  }

  private field(name: string): string {
    return this.input(name).value;
  }

  private input(name: string): HTMLInputElement {
    const found = this.inputs.namedItem(name);
    if (!(found instanceof HTMLInputElement)) throw Error(`Timer draft is missing ${name}`);
    return found;
  }

  private pageModel(): TimerPageModel {
    const seconds = this.duration;
    const long = seconds !== null && seconds >= 3600;
    return {
      runningLabel: this.page.runningLabel,
      runningHidden: this.page.runningHidden,
      formHidden: this.page.formHidden,
      formBusy: this.page.formBusy,
      time: seconds === null ? '—' : timerTime(seconds),
      unit: long ? 'timer : min : sek' : 'min : sek',
      long: String(long),
      draftDisabled: this.canDraft === undefined ? false : !this.canDraft,
      minusDisabled: !this.connected || this.canDraft === false || seconds === 1,
      plusDisabled: !this.connected || this.canDraft === false || seconds === 86400,
      startDisabled: !this.connected || !this.canStart || seconds === null,
      validationHidden: seconds !== null,
      recent: this.page.recent,
      recentWaiting: this.page.recentWaiting,
      recentHidden: this.page.recentHidden,
    };
  }

  private cardsOf(slot: CardSlot): CardState[] {
    return this.order[slot].flatMap(key => this.cards.get(key) ?? []);
  }

  private paint(slot: CardSlot) {
    const motion = this.host.motion;
    if (slot === 'overview') {
      const cards = this.cardsOf('overview');
      flushSync(() => {
        this.overviewRoot.render(
          cards.map(card => <TimerCard key={card.key} card={card} motion={motion} handlers={this.cardHandlers} />),
        );
      });
      return;
    }
    const page = this.pageModel();
    const cards = this.cardsOf('detail');
    flushSync(() => {
      this.detailRoot.render(
        <TimerPage
          page={page}
          cards={cards}
          motion={motion}
          cardHandlers={this.cardHandlers}
          handlers={this.pageHandlers}
        />,
      );
    });
  }

  private paintHeader(time: string | null) {
    const root = this.headerRoot;
    if (!root) return;
    const motion = this.host.motion;
    flushSync(() => {
      root.render(<HeaderTimerContent time={time} motion={motion} />);
    });
  }
}
