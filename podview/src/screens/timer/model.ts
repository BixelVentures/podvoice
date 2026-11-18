// The timer screen's records and view models. Timer records come from the scene (podview/timer-model.js,
// podview/scene-model.js and the live projection); the card and page models are what the React screen renders.
import type {ProgressSource} from '../../../ui/motion.js';

export interface Timer {
  id: string;
  name?: string | undefined;
  status: string;
  remaining: number;
  duration?: number | null | undefined;
  deadline?: number | null | undefined;
  stale?: boolean | undefined;
  hidden?: boolean | undefined;
  noticeDismissed?: boolean | undefined;
  ownerBootId?: string | undefined;
  physicalStopped?: boolean | undefined;
  physicalDrained?: boolean | undefined;
  displayState?: string | undefined;
  sourceRevision?: string | undefined;
}

export interface TimerHistoryItem {
  name?: string;
  seconds: number;
}

export interface TimerScene {
  focus?: string;
  connected?: boolean;
  timer?: Timer | null;
  extraTimers?: Timer[];
  timerHistory?: unknown;
  sessionId?: unknown;
  generation?: unknown;
}

export interface TimerAccess {
  connected: boolean | undefined;
  canStart: boolean | undefined;
  canCancel: boolean | undefined;
  restartIds: string[];
  pending: boolean;
  waiting: boolean;
  awaitingObservation: boolean;
  allowIndependentCancel: boolean;
  cancelBlockedIds: string[];
  canAdjust: boolean;
  adjustBlockedIds: string[];
  adjustPending: {timerId: string; deltaSeconds: number} | null;
  feedback: string;
}

export type CardSlot = 'overview' | 'detail';

// What one card shows of its timer: computed when the card is drawn (TimerView.card).
export interface CardContent {
  timerId: string;
  status: string;
  stale: string;
  progressKnown: string;
  progress: string;
  progressSource: ProgressSource;
  total: string;
  time: string;
  long: string;
  stateLabel: string;
  kicker: string;
  state: string;
  repeat: string;
  openLabel: string;
  finishLabel: string;
  finishAria: string;
  ringing: boolean;
}

export interface ToggleControl {
  hidden: boolean;
  disabled: boolean;
  label: string;
}

export interface AdjustControl {
  hidden: boolean;
  disabled: boolean;
  loading: boolean;
}

// The detail card's own controls: Pause/Fortsæt and ±1 min (renderTimerActions).
export interface CardActions {
  hidden: boolean;
  toggle: ToggleControl;
  plus: AdjustControl;
  minus: AdjustControl;
}

// »Start igen · 10 min« (renderRestart).
export interface CardRestart {
  hidden: boolean;
  disabled: boolean;
  label: string;
}

export interface CardState {
  key: string;
  slot: CardSlot;
  id: string;
  hidden: boolean;
  content: CardContent;
  actions: CardActions;
  restart: CardRestart;
  busy: boolean | undefined;
  finishDisabled: boolean;
}

export interface RecentChoice {
  seconds: number;
  time: string;
  label: string;
}

// The new-timer draft and the page around the cards.
export interface TimerPageModel {
  runningLabel: string;
  runningHidden: boolean;
  formHidden: boolean;
  formBusy: boolean | undefined;
  time: string;
  unit: string;
  long: string;
  draftDisabled: boolean;
  minusDisabled: boolean;
  plusDisabled: boolean;
  startDisabled: boolean;
  validationHidden: boolean;
  recent: RecentChoice[];
  recentWaiting: boolean;
  recentHidden: boolean;
}
