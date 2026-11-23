// The timer screen's records and view models. Timer records come from the scene (scene-model.js with
// timer-model.ts for the local preview, live-timers.ts for the native owner); the card and page models are what the
// components render (presentation.ts).

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
  physicalStopped?: boolean | null | undefined;
  physicalDrained?: boolean | null | undefined;
  alertState?: string | null | undefined;
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

// What one card shows of its timer (presentation.ts cardContent).
export interface CardContent {
  timerId: string;
  status: string;
  stale: string;
  progressKnown: string;
  progress: string;
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

// The detail card's own controls: Pause/Fortsæt and ±1 min (presentation.ts cardActions).
export interface CardActions {
  hidden: boolean;
  toggle: ToggleControl;
  plus: AdjustControl;
  minus: AdjustControl;
}

// »Start igen · 10 min« (presentation.ts cardRestart).
export interface CardRestart {
  hidden: boolean;
  disabled: boolean;
  label: string;
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
