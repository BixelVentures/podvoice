// Navigation for the HA panel, in one Zustand store: the screen stack (level = depth), the direction of the last
// move (the transition reads it), the screens kept mounted, and the room the page is about. Any tap wins at once, also
// mid-transition: the stack changes immediately and motion/react retargets from wherever the screens are.
//
// Bounded mounting (designed for ~10 screens): Hjem, the current screen and the previous one stay mounted and warm,
// so going back and forth never builds a screen. A screen is built on its first visit, or a moment earlier when the
// finger lands on its tile (prewarm); the previous screen is let go after a while without a visit (forget).
//
// The room: a tap on a room chip wins for the session; else the room in the panel's URL (/podview/<area_id>, so each
// wall tablet's kiosk URL fixes its room); else the integration's default area; else the main room (room.ts).
import {create} from 'zustand';

export type ScreenId =
  | 'home'
  | 'music'
  | 'find'
  | 'radio'
  | 'lights'
  | 'weather'
  | 'timers'
  | 'robot'
  | 'vehicle'
  | 'answers'
  | 'recipes'
  | 'recipe';

export interface Route {
  screen: ScreenId;
}

export interface NavState {
  stack: Route[];
  // 1 = forward (push), -1 = back.
  direction: 1 | -1;
  // The screen shown before the current one (kept mounted until forgotten).
  previous: ScreenId | null;
  // A screen built ahead of its visit (the finger is on its tile).
  warm: ScreenId | null;
  // The room chosen by a tap this session; null = the URL's room.
  room: string | null;
  // The area id in the panel's URL (/podview/<area_id>), or null.
  routeRoom: string | null;
  push: (screen: ScreenId) => void;
  back: () => void;
  home: () => void;
  prewarm: (screen: ScreenId) => void;
  forget: (screen: ScreenId) => void;
  // No one touched the wall for a while: Hjem, in the URL's room.
  idle: () => void;
  setRoom: (room: string) => void;
  setRouteRoom: (room: string | null) => void;
}

const HOME: Route = {screen: 'home'};
const top = (stack: Route[]): ScreenId => stack.at(-1)?.screen ?? 'home';

export const useNav = create<NavState>(set => ({
  stack: [HOME],
  direction: 1,
  previous: null,
  warm: null,
  room: null,
  routeRoom: null,
  push: screen => {
    set(state => {
      if (top(state.stack) === screen) return state;
      return {stack: [...state.stack, {screen}], direction: 1, previous: top(state.stack), warm: null};
    });
  },
  back: () => {
    set(state =>
      state.stack.length > 1 ? {stack: state.stack.slice(0, -1), direction: -1, previous: top(state.stack)} : state,
    );
  },
  home: () => {
    set(state => (state.stack.length > 1 ? {stack: [HOME], direction: -1, previous: top(state.stack)} : state));
  },
  prewarm: screen => {
    set(state => (state.warm === screen || top(state.stack) === screen ? state : {warm: screen}));
  },
  forget: screen => {
    set(state => {
      if (state.previous !== screen && state.warm !== screen) return state;
      return {
        previous: state.previous === screen ? null : state.previous,
        warm: state.warm === screen ? null : state.warm,
      };
    });
  },
  idle: () => {
    set(state => {
      if (state.stack.length === 1 && state.room === null) return state;
      const left = state.stack.length > 1 ? top(state.stack) : state.previous;
      return {stack: [HOME], direction: -1, previous: left, room: null};
    });
  },
  setRoom: room => {
    set({room});
  },
  setRouteRoom: routeRoom => {
    set(state => (state.routeRoom === routeRoom ? state : {routeRoom, room: null}));
  },
}));

export const currentScreen = (state: NavState): ScreenId => top(state.stack);
export const level = (state: NavState) => state.stack.length - 1;

// The screens that are mounted now: Hjem, the current, the previous and a prewarmed one, in a stable order.
export function mountedScreens(state: NavState, order: readonly ScreenId[]): ScreenId[] {
  const keep = new Set<ScreenId>(['home', top(state.stack)]);
  if (state.previous) keep.add(state.previous);
  if (state.warm) keep.add(state.warm);
  return order.filter(id => keep.has(id));
}

// The area id in HA's panel route ({prefix: '/podview', path: '/<area_id>'}), or null.
export function routeArea(route: unknown): string | null {
  const path = (route as {path?: unknown} | null)?.path;
  if (typeof path !== 'string') return null;
  const first = path.split('/').find(Boolean) ?? '';
  let area: string;
  try {
    area = decodeURIComponent(first);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_-]{1,128}$/.test(area) ? area : null;
}

export function resetNav() {
  useNav.setState({stack: [HOME], direction: 1, previous: null, warm: null, room: null, routeRoom: null});
}
