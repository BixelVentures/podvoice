// The panel's shell: the PodView frame (topbar, the screen stack, the room player beside it). The stack and its
// transitions and swipe back are stack.tsx; a tap mid-transition retargets at once (the stack is already the new one).
import {useEffect, useState} from 'react';
import {useShallow} from 'zustand/react/shallow';
import {useLink, usePanelConfig} from '../lib/ha/transport';
import {Button, Icon, IconButton} from '../ui';
import {ScreenBoundary} from './boundary';
import {BUILD, runningBundleId} from './build';
import {installIdleHome} from './health';
import {currentScreen, level, mountedScreens, useNav} from './nav';
import {enterRest, Rest} from './Rest';
import {ScreenStack} from './stack';
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
      <strong className="font-pv-mono text-[20px] leading-[26px] font-medium tracking-[-0.02em]">
        {time.replace('.', ':')}
      </strong>
      <span className="text-pv-meta text-pv-ink-3">{date}</span>
    </>
  );
}

// The Svar key's dot grille (the Svar key in the topbar).
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
  const under = useNav(state => state.stack.at(-2)?.screen);
  const back = useNav(state => state.back);
  const push = useNav(state => state.push);
  const {connected} = useLink();
  return (
    <nav
      aria-label="Visning"
      // The bar runs under the status bar (its shadow paints the 40 px above it).
      className="relative z-[3] -mx-6 mt-10 mb-3 flex h-16 shrink-0 items-center justify-between gap-2 bg-pv-topbar
        px-6 shadow-[0_-40px_0_0_var(--color-pv-topbar)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-pv-s2">
        {depth > 0 ? (
          // The screen a back reveals is built (or kept) as the finger lands, like a tile's (data-opens).
          <IconButton variant="quiet" size="round" aria-label="Tilbage" data-opens={under} onPress={back}>
            <Icon name="chevron-left" />
          </IconButton>
        ) : (
          <IconButton variant="quiet" size="round" aria-label="Gå til Ro" data-navigation="rest" onPress={enterRest}>
            <Icon name="moon" />
          </IconButton>
        )}
        <h1 id="header-title" tabIndex={-1}
          className="my-2 truncate text-[22px] leading-[26px] font-semibold tracking-[-0.01em] outline-none">
          {TITLES[screen]}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-pv-s3">
        {connected ? null : (
          <span className="text-pv-meta text-pv-ink-2" role="status">
            Forbinder til Home Assistant …
          </span>
        )}
        <Button
          id="open-history"
          size="sm"
          className="h-12 gap-pv-s2 px-pv-s2 pr-pv-s3 text-[20px] leading-6 font-semibold"
          data-opens="answers"
          aria-label="Se tidligere svar"
          aria-current={screen === 'answers' ? 'page' : false}
          onPress={() => {
            push('answers');
          }}
        >
          <span className="relative h-[22px] w-[46px] shrink-0" aria-hidden="true">
            {GRILLE.map(([left, top]) => (
              <i key={`${left}-${top}`} className="absolute size-[3.6px] rounded-full bg-pv-ink"
                style={{left: `${left}px`, top: `${top}px`}} />
            ))}
          </span>
          Svar
        </Button>
        <span className="flex items-baseline gap-pv-s1 whitespace-nowrap tabular-nums">
          {connected ? null : <span className="size-2 self-center rounded-full bg-pv-ink-3" aria-hidden="true" />}
          <Clock />
        </span>
      </div>
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
    <p className="mb-pv-s2 text-pv-meta text-pv-ink-2" role="status">
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
    <small className="mt-auto text-[11px] leading-5 text-pv-ink-3 opacity-70 select-text" data-diag="">
      {`PodVoice ${version} · build ${BUILD}${bundle ? ` · ${bundle}` : ''}`}
    </small>
  );
}

export function Shell({onReport}: {onReport?: (report: Report) => void}) {
  const mounted = useNav(useShallow(state => mountedScreens(state, ORDER)));
  const {connected, generation} = useLink();
  useMountBounds();
  usePrewarm();
  useIdleHome();
  return (
    // data-link is the link to Home Assistant: offline, the screens' cards dim themselves (group/host).
    <div
      className="group/host flex h-full flex-col pt-[var(--pv-safe-top-s,0px)] pb-[var(--pv-safe-bottom-s,0px)]"
      data-link={connected ? 'live' : 'offline'}
    >
      <TopBar />
      <main className="grid min-h-0 flex-1 grid-cols-[744px_356px] gap-x-pv-s4 gap-y-pv-s2" aria-label="PodView">
        <ScreenStack
          mounted={mounted}
          render={id => {
            const Screen = SCREENS[id];
            return (
              <>
                {connected ? null : <Stale />}
                <ScreenBoundary name={id} resetKeys={[generation]} {...(onReport ? {onReport} : {})}>
                  <Screen />
                </ScreenBoundary>
              </>
            );
          }}
        />
        <aside className="flex min-h-0 min-w-0 flex-col gap-pv-s2" aria-label="Rummets musik">
          <ScreenBoundary name="aside" resetKeys={[generation]} {...(onReport ? {onReport} : {})}>
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
    </div>
  );
}
