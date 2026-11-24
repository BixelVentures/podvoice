// The panel's shell: the PodView frame (topbar, the screen stack, the room player beside it) with motion/react
// screen transitions. Only transform and opacity move (compositor), on the kit's spring tokens; a push slides in from
// the right and a back from the left; a tap mid-transition retargets at once (the stack is already the new one).
// Reduced motion: a short linear cross-fade, no movement.
import {motion, useReducedMotion} from 'motion/react';
import type {Variants} from 'motion/react';
import {useEffect, useState} from 'react';
import {useShallow} from 'zustand/react/shallow';
import {TRANSITION} from '../lib/motion/tokens';
import {useLink, usePanelConfig} from '../lib/ha/transport';
import {KitButton} from '../lib/ui/KitButton';
import {ScreenBoundary} from './boundary';
import {BUILD, runningBundleId} from './build';
import {installIdleHome} from './health';
import {currentScreen, level, mountedScreens, useNav} from './nav';
import {enterRest, Rest} from './Rest';
import {TimerAlarm} from './TimerAlarm';
import type {ScreenId} from './nav';
import {useAnswers} from '../lib/ha/answers';
import {AnswersScreen, useAnswerRoom} from './screens/Answers';
import {FindMusicScreen} from './screens/FindMusic';
import {HomeScreen} from './screens/Home';
import {RadioScreen} from './screens/Radio';
import {RecipeScreen, RecipesScreen} from './screens/Recipes';
import {RobotPrefetch, RobotScreen} from './screens/Robot';
import {VehicleScreen} from './screens/Vehicle';
import {LightsScreen} from './screens/Lights';
import {MusicScreen, QueuePrefetch, RoomMusic} from './screens/Music';
import {TimersScreen} from './screens/Timers';
import {WeatherScreen} from './screens/Weather';
import type {Report} from './report';
import {icon} from './ui';

const TITLES: Record<ScreenId, string> = {
  home: 'Hjem',
  music: 'Musik',
  find: 'Find musik',
  radio: 'Radio',
  lights: 'Lys',
  weather: 'Vejr',
  timers: 'Timer',
  robot: 'Robot',
  vehicle: 'Bil',
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

// `transform` as a whole (not motion's x) so motion/react runs it as a Web Animation the compositor plays.
const DISTANCE = 48;
const shift = (px: number) => `translate3d(${String(px)}px, 0, 0)`;
type Place = 'center' | 'before' | 'after';
// A screen below the current one in the stack waits to the left, any other to the right. A mounted waiting screen
// stays drawn at opacity .001 on its own layer (will-change in panel.css), as the wall page arms Ro: WebKit keeps the
// layer's pixels, so showing it repaints nothing. It takes no taps (pointer-events) and is hidden from assistive
// technology (aria-hidden), never inert.
const WAITING = 0.001;
const slide: Variants = {
  center: {transform: shift(0), opacity: 1, pointerEvents: 'auto'},
  before: {transform: shift(-DISTANCE), opacity: WAITING, pointerEvents: 'none'},
  after: {transform: shift(DISTANCE), opacity: WAITING, pointerEvents: 'none'},
};
const fade: Variants = {
  center: {opacity: 1, pointerEvents: 'auto'},
  before: {opacity: WAITING, pointerEvents: 'none'},
  after: {opacity: WAITING, pointerEvents: 'none'},
};
const ORDER: ScreenId[] = [
  'home', 'music', 'find', 'radio', 'lights', 'weather', 'timers', 'robot', 'vehicle', 'answers', 'recipes', 'recipe',
];

function Clock() {
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
  const date = now.toLocaleDateString('da-DK', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Copenhagen'});
  return (
    <>
      <strong id="header-clock">{time.replace('.', ':')}</strong>
      <span id="header-date">{date}</span>
    </>
  );
}

// The Svar key's dot grille, as the wall page draws it (the Svar key in the topbar).
const GRILLE: readonly (readonly [string, string])[] = [
  ['2.0', '2.0'],
  ['8.4', '1.4'],
  ['15.4', '1.4'],
  ['22.4', '1.4'],
  ['29.4', '1.4'],
  ['36.4', '1.4'],
  ['44.0', '2.0'],
  ['2.0', '9.6'],
  ['8.4', '8.9'],
  ['15.4', '8.9'],
  ['22.4', '8.9'],
  ['29.4', '8.9'],
  ['36.4', '8.9'],
  ['44.0', '9.6'],
  ['2.0', '17.1'],
  ['8.4', '16.4'],
  ['15.4', '16.4'],
  ['22.4', '16.4'],
  ['29.4', '16.4'],
  ['36.4', '16.4'],
  ['44.0', '17.1'],
];

function TopBar() {
  const screen = useNav(currentScreen);
  const depth = useNav(level);
  const back = useNav(state => state.back);
  const push = useNav(state => state.push);
  const {connected} = useLink();
  return (
    <nav className="view-nav" aria-label="Visning">
      <div className="header-left">
        <div className="header-navigation">
          {depth > 0 ? (
            <KitButton id="nav-back" className="detail-back" aria-label="Tilbage" onPress={back}>
              <img src={icon('chevron-left')} alt="" />
            </KitButton>
          ) : (
            <KitButton id="show-photo" aria-label="Gå til Ro" data-navigation="rest" onPress={enterRest}>
              <img src={icon('moon')} alt="" />
              <span className="rest-label">Ro</span>
            </KitButton>
          )}
        </div>
        <h1 id="header-title" className="header-title" tabIndex={-1}>
          {TITLES[screen]}
        </h1>
      </div>
      <span className="header-context">
        <KitButton
          id="open-history"
          className="header-history"
          data-opens="answers"
          aria-label="Se tidligere svar"
          aria-current={screen === 'answers' ? 'page' : undefined}
          onPress={() => {
            push('answers');
          }}
        >
          <span className="pv-svar-grille" aria-hidden="true">
            {GRILLE.map(([left, top]) => (
              <i key={`${left}-${top}`} style={{left: `${left}px`, top: `${top}px`}} />
            ))}
          </span>
          <span>
            <strong>Svar</strong>
          </span>
        </KitButton>
        <span className="header-time pv-panel-time">
          <span id="header-offline-dot" className="header-offline-dot" aria-hidden="true" hidden={connected} />
          <Clock />
        </span>
        {connected ? null : (
          <span className="pv-panel-offline" role="status">
            Forbinder til Home Assistant …
          </span>
        )}
      </span>
    </nav>
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
export const STALE_TEXT = 'Sidst kendt · ingen forbindelse til Home Assistant';

function Stale() {
  return (
    <p className="pv-panel-stale" role="status">
      {STALE_TEXT}
    </p>
  );
}

// What the wall runs, in a corner: the integration's version, the build and the bundle digest. An update of the
// integration reaches the wall after a Home Assistant restart.
function Diagnostics() {
  const config = usePanelConfig();
  const version = typeof config?.integration_version === 'string' ? config.integration_version : '?';
  const bundle = runningBundleId();
  return (
    <small className="pv-panel-diag" data-diag="">
      {`PodVoice ${version} · build ${BUILD}${bundle ? ` · ${bundle}` : ''}`}
    </small>
  );
}

export function Shell({onReport}: {onReport?: (report: Report) => void}) {
  const stack = useNav(state => state.stack);
  const screen = useNav(currentScreen);
  const direction = useNav(state => state.direction);
  const mounted = useNav(useShallow(state => mountedScreens(state, ORDER)));
  const {connected} = useLink();
  const reduced = useReducedMotion() ?? false;
  useMountBounds();
  usePrewarm();
  useIdleHome();
  const place = (id: ScreenId): Place =>
    id === screen ? 'center' : stack.some(route => route.screen === id) ? 'before' : 'after';
  return (
    <pv-widget-host data-view="active" data-panel="ha" data-link={connected ? 'live' : 'offline'}>
      <TopBar />
      <main className="frame" aria-label="PodView">
        <section className="responses pv-panel-stack" aria-label="Hjemmet">
          {mounted.map(id => {
            const Screen = SCREENS[id];
            const at = place(id);
            // Built for this move: enter from the side it comes from (initial only counts on mount). Hjem is mounted
            // from the page's first render on and never enters.
            const enter = id === 'home' || at !== 'center' ? false : direction === 1 ? 'after' : 'before';
            return (
              <motion.div
                key={id}
                className="pv-panel-screen"
                data-screen={id}
                data-place={at}
                aria-hidden={at === 'center' ? undefined : true}
                variants={reduced ? fade : slide}
                initial={enter}
                animate={at}
                transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
              >
                {connected ? null : <Stale />}
                <ScreenBoundary name={id} {...(onReport ? {onReport} : {})}>
                  <Screen />
                </ScreenBoundary>
              </motion.div>
            );
          })}
        </section>
        <aside className="pv-panel-aside" aria-label="Rummets musik">
          <ScreenBoundary name="aside" {...(onReport ? {onReport} : {})}>
            <RoomMusic compact />
          </ScreenBoundary>
          <Diagnostics />
        </aside>
      </main>
      <AnswersPrefetch />
      <RobotPrefetch />
      <QueuePrefetch />
      <Rest />
      <TimerAlarm />
    </pv-widget-host>
  );
}
