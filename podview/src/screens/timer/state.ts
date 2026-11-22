// The timer screen's state outside React, in one place:
// - the scene's timers (the shell's scene owns the records while it owns navigation: the local preview's timers and
//   the live projection with its stale marks; it publishes them after each render, publishTimerScene),
// - the live command lifecycle (commands.ts) on the registered API, the cached snapshot and the connection,
// - the live display anchor (display.ts),
// - the finished-timer alarm's completion records (timer-notice.js publishes them).
import {create} from 'zustand';
import {currentApi} from '../../lib/api/client';
import type {Snapshot} from '../../lib/api/schemas';
import {timerRequest} from '../../lib/api/timer-actions';
import type {TimerEvent} from '../../lib/api/timer-actions';
import {readConnection, readSnapshot} from '../../lib/query/live';
import type {Connection} from '../../lib/query/live';
import {useShell} from '../../lib/store/shell';
import {liveTimerAccess, previewTimerAccess} from './access';
import {createTimerCommands} from './commands';
import type {CommandState, StartToken} from './commands';
import {createTimerDisplay} from './display';
import type {Timer, TimerAccess} from './model';
import {timerPresentation} from './presentation';
import type {TimerCompletion} from './presentation';

export interface TimerScene {
  live: boolean;
  focus: string;
  // The scene's own connection flag (local preview authority).
  connected: boolean;
  timers: Timer[];
  timerHistory: unknown;
  sessionId: unknown;
  generation: unknown;
}

const EMPTY: TimerScene = {live: false, focus: 'now', connected: true, timers: [], timerHistory: [], sessionId: null,
  generation: null};

let sceneSignature = '';
export const useTimerScene = create<TimerScene>(() => EMPTY);

// The shell's scene after its render; an unchanged scene notifies nobody.
export function publishTimerScene(scene: TimerScene) {
  const signature = JSON.stringify(scene);
  if (signature === sceneSignature) return;
  sceneSignature = signature;
  useTimerScene.setState(scene, true);
}

export const useTimerCompletions = create<{completions: ReadonlyMap<string, TimerCompletion>}>(() => ({
  completions: new Map(),
}));
export function publishTimerCompletions(completions: ReadonlyMap<string, TimerCompletion>) {
  useTimerCompletions.setState({completions: new Map([...completions].map(([id, record]) => [id, {...record}]))});
}

export const liveConnected = (connection: Connection = readConnection()) =>
  connection.mode === 'live' && connection.status === 'connected' && connection.connected;

// Back to Home once the started timer is observed, when the page still shows the same scene (TimerView's
// completeStartNavigation).
export function completeStart(token: StartToken, timerId: string | null, snapshot = readSnapshot()) {
  const scene = useTimerScene.getState();
  if (scene.focus !== 'timers' || scene.sessionId !== token.sessionId || scene.generation !== token.generation) return;
  if (scene.live) {
    if (!snapshot || snapshot.bootId !== token.bootId || snapshot.roomId !== token.roomId) return;
    if (snapshot.timers.status !== 'observed' || snapshot.timers.epoch !== token.epoch) return;
    const row = snapshot.timers.items.find(item => item.id === timerId);
    const current = scene.timers.find(timer => timer.id === timerId);
    if (!row || current?.stale || !(row.status === 'running' || row.status === 'paused')) return;
  }
  const shell = useShell.getState();
  shell.dispatch({type: 'show', id: 'now'});
  shell.focusHeading();
}

export const timerCommands = createTimerCommands({
  api: currentApi,
  snapshot: readSnapshot,
  connected: () => liveConnected(),
  toast: text => {
    useShell.getState().showFeedback(text);
  },
  completeStart,
});

export const timerDisplay = createTimerDisplay();

export function timerAccess(
  scene: TimerScene,
  commands: CommandState,
  snapshot: Snapshot | null,
  connection: Pick<Connection, 'mode' | 'status'>,
): TimerAccess {
  return scene.live
    ? liveTimerAccess(commands, snapshot, connection.mode === 'live' && connection.status === 'connected')
    : previewTimerAccess(scene.connected);
}

export const currentTimerAccess = () =>
  timerAccess(useTimerScene.getState(), timerCommands.getState(), readSnapshot(), readConnection());

// The anchor follows the current timer and the freshness of the read (called after each shell render).
export function syncTimerDisplay(now = Date.now()) {
  const scene = useTimerScene.getState();
  const connection = readConnection();
  const current = timerPresentation(scene.timers).current;
  const age = now - (connection.acceptedReadAt ?? Number.NaN);
  const fresh =
    connection.mode === 'live' && !connection.browserOffline && connection.status === 'connected' &&
    connection.connected && !connection.blocked && age >= 0 && age < 6000;
  timerDisplay.sync(current, {live: scene.live, snapshot: readSnapshot(), fresh,
    accessConnected: currentTimerAccess().connected === true});
}

// One explicit tap: live it is a request to the native owner, in the local preview a scene event.
export function timerCommand(event: TimerEvent & {now?: number}) {
  if (!useTimerScene.getState().live) {
    useShell.getState().dispatch({now: Date.now(), ...event});
    return;
  }
  const request = timerRequest(readSnapshot(), liveConnected(), event);
  if (request) void timerCommands.send(request);
}

// A fresh page life (tests; the shell's state lives as long as the page).
export function resetTimerState() {
  sceneSignature = '';
  useTimerScene.setState(EMPTY, true);
  useTimerCompletions.setState({completions: new Map()});
  timerCommands.suspend();
  timerCommands.setState({action: null, pending: false, feedback: '', phase: null, fences: [], queued: null,
    startNavigation: null});
  timerDisplay.reset();
}
