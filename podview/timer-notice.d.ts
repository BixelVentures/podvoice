// Types for the pre-React finished-timer alarm (#timer-alert) used by src/screens/timer.
import type {Timer, TimerAccess} from './src/screens/timer/model';

export interface TimerCompletion {
  at: number;
  started?: number;
  played: boolean;
  exhausted: boolean;
}

export class TimerNotice {
  constructor(host: unknown, element: HTMLElement | null, options?: {onElapsed?: () => void});
  completions: Map<string, TimerCompletion>;
  render(
    timer: Timer | null | undefined,
    focus: string | undefined,
    live: boolean | undefined,
    feedbackVisible?: boolean,
    visibleTimerId?: string | null,
    access?: Partial<TimerAccess> & {canCancel?: boolean | undefined},
  ): void;
  cleanup(): void;
}
