// What every timer surface reads: the current timer as shown (with the live display anchor), the access the
// controls follow, and the alarm's record of it. All from the stores and the query cache.
import {useStore} from 'zustand';
import {useConnection, useSnapshot} from '../../lib/query/live';
import type {Connection} from '../../lib/query/live';
import type {Timer, TimerAccess} from './model';
import {presentTimer, shownOf} from './display';
import {timerPresentation} from './presentation';
import type {TimerCompletion} from './presentation';
import {timerAccess, timerCommands, timerDisplay, useTimerCompletions, useTimerScene} from './state';
import type {TimerScene} from './state';

export interface TimerView {
  scene: TimerScene;
  // The one timer the screen shows, as shown now.
  current: Timer | null;
  access: TimerAccess;
  completion: TimerCompletion | undefined;
}

// The access rules read the connection's state, not its heartbeat time.
const status = ({mode, status: state}: Connection) => ({mode, status: state});

export function useTimer({visibleOnly = false}: {visibleOnly?: boolean} = {}): TimerView {
  const scene = useTimerScene();
  const commands = useStore(timerCommands);
  const snapshot = useSnapshot();
  const connection = useConnection(status);
  const shown = useStore(timerDisplay, shownOf);
  const completions = useTimerCompletions(state => state.completions);
  const timers = visibleOnly ? scene.timers.filter(timer => !timer.hidden) : scene.timers;
  const source = timerPresentation(timers).current;
  const current = source ? presentTimer(source, shown) : null;
  const access = timerAccess(scene, commands, snapshot, connection);
  return {scene, current, access, completion: current ? completions.get(current.id) : undefined};
}
