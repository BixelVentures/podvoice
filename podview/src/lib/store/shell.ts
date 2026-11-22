// What the legacy shell (podview/widget-view.js) tells the React screens, and the few requests React makes of it.
// The shell still owns navigation: it writes the focused page here; React reacts. React asks the shell to navigate
// or to re-read home through the ports the shell registers once (connectShell). See src/README.md.
import {create} from 'zustand';

// A scene event the shell's dispatch understands ({type: 'show', id: 'timers'}, local preview timer events).
export type ShellEvent = {type: string} & Record<string, unknown>;

export interface ShellPorts {
  dispatch: (event: ShellEvent) => void;
  focusHeading: () => void;
  // Re-read the home projection (weather advice completion is read through it).
  loadHome: () => void;
  // The shell's toast (»Timeranmodningen er modtaget«).
  showFeedback: (text: string) => void;
}

export interface ShellState extends ShellPorts {
  // The page in front: 'now' (Home), 'timers', 'weather', …
  focus: string;
  // The shell's motion handle (ui/motion.js SceneMotion), for the rolling digits still owned by the kit.
  motion: unknown;
}

const NOOP: ShellPorts = {
  dispatch: () => undefined,
  focusHeading: () => undefined,
  loadHome: () => undefined,
  showFeedback: () => undefined,
};

export const useShell = create<ShellState>(() => ({...NOOP, focus: 'now', motion: null}));

export function connectShell(ports: Partial<ShellPorts> & {motion?: unknown}) {
  useShell.setState(ports);
}

// The shell writes the focused page (and its motion handle) on each render; unchanged values notify nobody.
export function setFocus(focus: string, motion: unknown = useShell.getState().motion) {
  const state = useShell.getState();
  if (state.focus !== focus || state.motion !== motion) useShell.setState({focus, motion});
}
