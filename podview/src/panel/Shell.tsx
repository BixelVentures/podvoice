// The panel's shell: the PodView frame (topbar, the screen stack, the room player beside it) with motion/react
// screen transitions. Only transform and opacity move (compositor), on the kit's spring tokens; a push slides in from
// the right and a back from the left; a tap mid-transition retargets at once (the stack is already the new one).
// Reduced motion: a short linear cross-fade, no movement.
import {motion, useReducedMotion} from 'motion/react';
import type {Variants} from 'motion/react';
import {useEffect, useState} from 'react';
import {TRANSITION} from '../lib/motion/tokens';
import {useLink} from '../lib/ha/transport';
import {KitButton} from '../lib/ui/KitButton';
import {currentScreen, level, useNav} from './nav';
import type {ScreenId} from './nav';
import {HomeScreen} from './screens/Home';
import {LightsScreen} from './screens/Lights';
import {MusicScreen, RoomMusic} from './screens/Music';
import {TimersScreen} from './screens/Timers';
import {WeatherScreen} from './screens/Weather';
import {icon} from './ui';

const TITLES: Record<ScreenId, string> = {home: 'Hjem', music: 'Musik', lights: 'Lys', weather: 'Vejr', timers: 'Timer'};

const SCREENS: Record<ScreenId, () => React.JSX.Element> = {
  home: HomeScreen,
  music: MusicScreen,
  lights: LightsScreen,
  weather: WeatherScreen,
  timers: TimersScreen,
};

// `transform` as a whole (not motion's x) so motion/react runs it as a Web Animation the compositor plays.
const DISTANCE = 48;
const shift = (px: number) => `translate3d(${String(px)}px, 0, 0)`;
type Place = 'center' | 'before' | 'after';
// A screen below the current one in the stack waits to the left, any other to the right. A waiting screen stays
// drawn at opacity .001 on its own layer (will-change in panel.css), as the wall page arms Ro: WebKit keeps the
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
const ORDER: ScreenId[] = ['home', 'music', 'lights', 'weather', 'timers'];

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

function TopBar() {
  const screen = useNav(currentScreen);
  const depth = useNav(level);
  const back = useNav(state => state.back);
  const {connected} = useLink();
  return (
    <nav className="view-nav" aria-label="Visning">
      <div className="header-left">
        <div className="header-navigation">
          {depth > 0 ? (
            <KitButton id="nav-back" className="detail-back" aria-label="Tilbage" onPress={back}>
              <img src={icon('chevron-left')} alt="" />
            </KitButton>
          ) : null}
        </div>
        <h1 id="header-title" className="header-title" tabIndex={-1}>
          {TITLES[screen]}
        </h1>
      </div>
      <span className="header-context">
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

// Every screen is mounted once and stays: a move only animates transform and opacity, so no transition waits for
// a screen to be built or styled. The stack decides each screen's place; a tap mid-move retargets at once.
export function Shell() {
  const stack = useNav(state => state.stack);
  const screen = useNav(currentScreen);
  const reduced = useReducedMotion() ?? false;
  const place = (id: ScreenId): Place =>
    id === screen ? 'center' : stack.some(route => route.screen === id) ? 'before' : 'after';
  return (
    <pv-widget-host data-view="active" data-panel="ha">
      <TopBar />
      <main className="frame" aria-label="PodView">
        <section className="responses pv-panel-stack" aria-label="Hjemmet">
          {ORDER.map(id => {
            const Screen = SCREENS[id];
            const at = place(id);
            return (
              <motion.div
                key={id}
                className="pv-panel-screen"
                data-screen={id}
                data-place={at}
                aria-hidden={at === 'center' ? undefined : true}
                variants={reduced ? fade : slide}
                initial={false}
                animate={at}
                transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
              >
                <Screen />
              </motion.div>
            );
          })}
        </section>
        <aside className="pv-panel-aside" aria-label="Rummets musik">
          <RoomMusic compact />
        </aside>
      </main>
    </pv-widget-host>
  );
}
