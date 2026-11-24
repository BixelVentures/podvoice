// The shell's state the screens read (focus and the motion handle) and the few requests a screen makes of it.
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
  // The local preview's station choice (a scene event; live choices go to the radio source).
  selectLocalRadio: (stationId: string) => void;
}

export interface ShellState extends ShellPorts {
  // The page in front: 'now' (Home), 'timers', 'weather', …
  focus: string;
  // An optional motion handle for the rolling digits (none on the panel: motion/react draws them).
  motion: unknown;
}

const NOOP: ShellPorts = {
  dispatch: () => undefined,
  focusHeading: () => undefined,
  loadHome: () => undefined,
  showFeedback: () => undefined,
  selectLocalRadio: () => undefined,
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
