// Navigation for the HA panel, in one Zustand store: the screen stack (level = depth), the direction of the last
// move (the transition reads it) and the room the page is about. Any tap wins at once, also mid-transition: the
// stack changes immediately and motion/react retargets from wherever the screens are.
import {create} from 'zustand';

export type ScreenId = 'home' | 'music' | 'lights' | 'weather' | 'timers';

export interface Route {
  screen: ScreenId;
}

export interface NavState {
  stack: Route[];
  // 1 = forward (push), -1 = back.
  direction: 1 | -1;
  // The HA area the page shows; null = the first room HA has.
  room: string | null;
  push: (screen: ScreenId) => void;
  back: () => void;
  home: () => void;
  setRoom: (room: string) => void;
}

const HOME: Route = {screen: 'home'};

export const useNav = create<NavState>(set => ({
  stack: [HOME],
  direction: 1,
  room: null,
  push: screen => {
    set(state => {
      const top = state.stack.at(-1);
      if (top?.screen === screen) return state;
      return {stack: [...state.stack, {screen}], direction: 1};
    });
  },
  back: () => {
    set(state => (state.stack.length > 1 ? {stack: state.stack.slice(0, -1), direction: -1} : state));
  },
  home: () => {
    set(state => (state.stack.length > 1 ? {stack: [HOME], direction: -1} : state));
  },
  setRoom: room => {
    set({room});
  },
}));

export const currentScreen = (state: NavState): ScreenId => state.stack.at(-1)?.screen ?? 'home';
export const level = (state: NavState) => state.stack.length - 1;

export function resetNav() {
  useNav.setState({stack: [HOME], direction: 1, room: null});
}
