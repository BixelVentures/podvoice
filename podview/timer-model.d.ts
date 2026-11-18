// Types for the pre-React timer model used by src/screens/timer.
import type {Timer, TimerScene} from './src/screens/timer/model';

export function timersFor(s: TimerScene): Timer[];
export function timerFinishLabel(t: Timer | null | undefined): string;
export function timerStateLabel(t: Timer): string;
export function timerProgress(t: Timer | null | undefined): number | null;
export function timerAdjustmentBounds(t: Timer | null | undefined): {minus: boolean; plus: boolean} | null;
export function timerTime(seconds: number): string;
export function timerDurationLabel(seconds: number): string;
export function adjustTimerDuration(seconds: number, delta: number): number;
export function readTimerDuration(hours: string, minutes: string, seconds: string): number | null;
