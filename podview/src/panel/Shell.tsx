// The panel's shell: the PodView frame (topbar, the screen stack, the room player beside it). The stack and its
// transitions are stack.tsx; Tilbage in the topbar is the way back (there is no swipe back). A tap mid-transition
// retargets at once (the stack is already the new one).
import {motion, useReducedMotion} from 'motion/react';
import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {create} from 'zustand';
import {TRANSITION} from '../lib/motion/tokens';
import {useShallow} from 'zustand/react/shallow';
import {useLink, usePanelConfig} from '../lib/ha/transport';
import {cx, Topbar} from '../ui';
import {ScreenBoundary} from './boundary';
import {installIdleHome} from './health';
import {currentScreen, level, mountedScreens, useNav} from './nav';
import {enterRest, PhotosPrefetch, Rest} from './Rest';
import {ScreenSettings} from './ScreenSettings';
import {useScreenTitles} from './titles';
import {ScreenStack} from './stack';
import {TimerAlarm} from './TimerAlarm';
import type {ScreenId} from './nav';
import {useAnswers} from '../lib/ha/answers';
import {AnswersScreen, useAnswerRoom, useSvarPill} from './screens/Answers';
import {FindMusicScreen} from './screens/FindMusic';
import {RadioScreen} from './screens/Radio';
import {RecipeScreen, RecipesScreen} from './screens/Recipes';
import {RobotPrefetch, RobotScreen, useRobotWidget} from './screens/Robot';
import {VehicleScreen} from './screens/Vehicle';
import {LightsScreen} from './screens/Lights';
import {MusicScreen, QueuePrefetch, RoomPlayer} from './screens/Music';
import {TimersScreen, useTimerWidget} from './screens/Timers';
import {useHaWeather, WeatherScreen} from './screens/Weather';
import {degrees, HomeScreen, weatherGlyph} from './screens/Home';
import type {Report} from './report';

const TITLES: Record<ScreenId, string> = {
  home: 'Hjem',
  music: 'Afspiller',
  find: 'Find musik',
  radio: 'Radio',
  lights: 'Lys',
  weather: 'Vejr',
  timers: 'Timer',
  robot: 'Robotstøvsuger',
  vehicle: 'Tesla',
  answers: 'Svar',
  recipes: 'Opskrifter',
  recipe: 'Opskrift',
};

const SCREENS: Record<ScreenId, () => React.JSX.Element> = {
  home: HomeScreen,
  music: MusicScreen,
  lights: LightsScreen,
  weather: WeatherScreen,
  timers: TimersScreen,
  robot: RobotScreen,
  vehicle: VehicleScreen,
  answers: AnswersScreen,
  find: FindMusicScreen,
  radio: RadioScreen,
  recipes: RecipesScreen,
  recipe: RecipeScreen,
};

const ORDER: ScreenId[] = [
  'home', 'music', 'find', 'radio', 'lights', 'weather', 'timers', 'robot', 'vehicle', 'answers', 'recipes', 'recipe',
];

// The topbar's clock and date as the wall shows them: »14.30« and »Man. 9. nov.«, read again on the minute.
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let handle = 0;
    const schedule = () => {
      handle = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    return () => {
      window.clearTimeout(handle);
    };
  }, []);
  const time = now.toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen'});
  const date = now.toLocaleDateString('da-DK', {weekday: 'short', day: 'numeric', month: 'short',
    timeZone: 'Europe/Copenhagen'});
  return {time, date: date.charAt(0).toLocaleUpperCase('da-DK') + date.slice(1)};
}

function TopBar() {
  const screen = useNav(currentScreen);
  const title = useScreenTitles(state => state.titles[screen]);
  // Skærm og enhed (A-Skaerm) opens from the clock.
  const [settings, setSettings] = useState(false);
  const depth = useNav(level);
  const under = useNav(state => state.stack.at(-2)?.screen);
  const back = useNav(state => state.back);
  const direction = useNav(state => state.direction);
  const push = useNav(state => state.push);
  const {connected} = useLink();
  const {model} = useHaWeather();
  const {time, date} = useClock();
  const current = model.current;
  // A running timer is a chip on every page but Timer; a robot fault is a badge on every page but Robot.
  const timer = useTimerWidget();
  const robot = useRobotWidget();
  // The Svar key shows the voice's phase (the add-on's sensor) and an unread answer (Kit-SvarKnap).
  const pill = useSvarPill();
  return (
    <>
    <Topbar
      // The bar runs under the status bar (its shadow paints the 40 px above it).
      className="relative z-[3] -mx-6 mt-4 shrink-0 shadow-[0_-40px_0_0_var(--color-pv-topbar)]"
      heading={title ?? TITLES[screen]}
      page={`${String(depth)}:${screen}`}
      direction={direction}
      onClock={() => {
        setSettings(true);
      }}
      back={depth > 0 ? {onPress: back, ...(under ? {opens: under} : {})} : null}
      onRest={enterRest}
      svar={{current: screen === 'answers', onPress: () => {
        push('answers');
      }}}
      svarState={pill.state}
      {...(pill.voice ? {voice: pill.voice} : {})}
      weather={current ? {temperature: degrees(current.temperature), condition: current.condition,
        glyph: weatherGlyph(current.icon)} : null}
      clock={time}
      date={date}
      timer={screen !== 'timers' && (timer.state === 'koerer' || timer.state === 'pause') ? {count: timer.prim,
        name: timer.name ?? 'Timer', left: timer.ring ?? 1, onPress: () => {
          push('timers');
        }} : null}
      alert={screen !== 'robot' && robot?.state === 'fejl' ? {text: 'Robotfejl', domain: 'Robotstøvsuger',
        onPress: () => {
          push('robot');
        }} : null}
      status={connected ? null : (
        <span className="flex items-center gap-2 text-[15px] text-pv-ink-2" role="status">
          <span className="size-2 rounded-full bg-pv-ink-3" aria-hidden="true" />
          {OFFLINE_TEXT}
        </span>
      )}
    />
    <ScreenSettings isOpen={settings} onClose={() => {
      setSettings(false);
    }} />
    </>
  );
}

// The canvas's exceptions to the player column (docs/PODVIEW-PARITY.md): Opskrifter and Opskrift take the full
// width; Ro has its own glass music card (Rest.tsx, over everything). A screen that shows a view without the player
// only part of the time (the opened Svar card, A-SvarKort) says so while it shows it (useWithoutPlayer).
const FULL_WIDTH: readonly ScreenId[] = ['recipes', 'recipe'];

export const usePlayerOptOut = create<{screens: Partial<Record<ScreenId, boolean>>}>(() => ({screens: {}}));

/** A screen showing a full-width view (the opened Svar card) hides the player column while `active`. */
export function useWithoutPlayer(id: ScreenId, active: boolean) {
  useEffect(() => {
    usePlayerOptOut.setState(state => ({screens: {...state.screens, [id]: active}}));
    return () => {
      usePlayerOptOut.setState(state => ({screens: {...state.screens, [id]: false}}));
    };
  }, [id, active]);
}

function withPlayer(id: ScreenId) {
  return !FULL_WIDTH.includes(id) && !usePlayerOptOut.getState().screens[id];
}

// The player column at the right; it steps aside (a fade and 24 px) while the shown screen has no player, and is
// never a target then. It stays mounted, so it is there at once when the next screen has it.
function PlayerColumn({children}: {children: ReactNode}) {
  const screen = useNav(currentScreen);
  const optOut = usePlayerOptOut(state => !!state.screens[screen]);
  const shown = !FULL_WIDTH.includes(screen) && !optOut;
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.aside
      className="absolute top-4 right-0 bottom-6 z-[2] flex w-[372px] min-w-0 flex-col"
      aria-label="Rummets musik"
      aria-hidden={shown ? undefined : true}
      initial={false}
      animate={shown ? {opacity: 1, x: 0} : {opacity: 0, x: reduced ? 0 : 24}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.nav}
      style={{pointerEvents: shown ? 'auto' : 'none'}}
    >
      {children}
    </motion.aside>
  );
}

// How long the previous screen stays mounted without a visit, and a prewarmed one without its push.
export const PREVIOUS_KEEP_MS = 60_000;
export const WARM_KEEP_MS = 3000;

// Hjem, the current screen and the previous one are mounted (nav.ts mountedScreens); any other screen is built on
// its first visit, or when the finger lands on its tile (prewarm). A mounted screen keeps its own compositing layer,
// so a move only animates transform and opacity. A screen built for a push enters from its side like any other; on
// the page's first render nothing animates. Each screen has its own error boundary.
function useMountBounds() {
  const previous = useNav(state => state.previous);
  const warm = useNav(state => state.warm);
  const forget = useNav(state => state.forget);
  useEffect(() => {
    if (!previous) return;
    const handle = setTimeout(() => {
      forget(previous);
    }, PREVIOUS_KEEP_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [previous, forget]);
  useEffect(() => {
    if (!warm) return;
    const handle = setTimeout(() => {
      forget(warm);
    }, WARM_KEEP_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [warm, forget]);
}

// Any control that opens a screen says which (data-opens="<screen>"): the finger landing on it builds that screen,
// so the push after the release animates a screen that already exists (a cold mount's work happens before the
// slide, never during it).
function usePrewarm() {
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-opens]') : null;
      const screen = target?.getAttribute('data-opens');
      if (screen && (ORDER as readonly string[]).includes(screen)) useNav.getState().prewarm(screen as ScreenId);
    };
    window.addEventListener('pointerdown', down, {capture: true, passive: true});
    return () => {
      window.removeEventListener('pointerdown', down, {capture: true});
    };
  }, []);
}

// Svar's answers are subscribed to when the page starts (the card is then ready when Svar is first built, and a live
// answer is in the cache before Svar opens).
function AnswersPrefetch() {
  const link = useLink();
  useAnswers(useAnswerRoom(), link.generation, link.connected);
  return null;
}

function useIdleHome() {
  const config = usePanelConfig();
  const raw = config?.idle_home_seconds;
  const seconds = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_IDLE_HOME_SECONDS;
  useEffect(
    () =>
      installIdleHome({
        seconds: () => seconds,
        onIdle: () => {
          useNav.getState().idle();
        },
      }),
    [seconds],
  );
}

export const DEFAULT_IDLE_HOME_SECONDS = 120;
// Offline never adds a row (G7 ruling): the topbar's »Forbinder til Home Assistant …« is the signal, the cards dim
// (data-link) and data older than 30 minutes carries its K-Fresh »Opdateret hh.mm«.
export const OFFLINE_TEXT = 'Forbinder til Home Assistant …';

export function Shell({onReport}: {onReport?: (report: Report) => void}) {
  const mounted = useNav(useShallow(state => mountedScreens(state, ORDER)));
  // A screen's width follows its player opt-out (the opened Svar card takes the player's column).
  usePlayerOptOut(state => state.screens);
  const {connected, generation} = useLink();
  useMountBounds();
  usePrewarm();
  useIdleHome();
  return (
    // data-link is the link to Home Assistant: offline, the screens' cards dim themselves (group/host).
    <div
      className="group/host relative flex h-full flex-col"
      data-link={connected ? 'live' : 'offline'}
    >
      <TopBar />
      {/* Edge 24 · the column 736 · 24 · the player 372 · 24; content 16 under the bar and 24 above the bottom.
          The screens' stack spans the whole width; a screen with the player keeps to the 736 column, one without
          it (FULL_WIDTH) takes all 1132, and the player steps aside while it is shown. */}
      <main className="relative flex min-h-0 flex-1 flex-col pt-4 pb-6" aria-label="PodView">
        <ScreenStack
          mounted={mounted}
          wide={id => !withPlayer(id)}
          render={id => {
            const Screen = SCREENS[id];
            return (
              <div className={cx('flex flex-[1_0_auto] flex-col', withPlayer(id) ? 'w-[736px]' : 'w-full')}>
                <ScreenBoundary name={id} resetKeys={[generation]} {...(onReport ? {onReport} : {})}>
                  <Screen />
                </ScreenBoundary>
              </div>
            );
          }}
        />
        <PlayerColumn>
          <ScreenBoundary name="aside" resetKeys={[generation]} {...(onReport ? {onReport} : {})}>
            <RoomPlayer />
          </ScreenBoundary>
        </PlayerColumn>
      </main>
      <AnswersPrefetch />
      <PhotosPrefetch />
      <RobotPrefetch />
      <QueuePrefetch />
      <Rest />
      <TimerAlarm />
    </div>
  );
}
