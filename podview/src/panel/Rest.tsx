// Ro (Foto-Ro, the design canvas's A-FotoRo, FotoRo-Aktiv and Foto-Nat) on the panel: after three minutes without a
// touch, key or scroll the panel rests in Ro: the photo carousel (the shared iCloud album) with the 168-px clock and
// the date over it, the weather at the top right, »Tryk for at åbne hjemmet«, and the glass cards: the activity on the
// left (a timer first, else the robot running or in fault, else the car charging; the arrow opens its page) and the
// music always on the right (rest-music.tsx: a pause/play or stop key for music and radio only). A tap anywhere else
// ripples at the finger and wakes the panel to Hjem. It does not rest while a timer has finished (the alarm is up),
// while Svar is open (an answer is being read), while a text field has focus or while the page is hidden. At night
// (21–07, Copenhagen) Ro is the night screen: black, the clock and the weather in dim warm red, a running timer as a
// dim pill, no photo, no cards, no animation; a tap there wakes Foto-Ro (and three quiet minutes later it is night
// again). With the wall's automatic dimming off (Skærm og enhed, screen-settings.ts) there is no night screen. The
// clock drifts 4 px a minute so the panel never burns in. Motion: opacity and transform only (compositor).
import {animate, motion, useMotionValue, useReducedMotion} from 'motion/react';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from 'react-aria-components';
import {create} from 'zustand';
import {usePhotoAlbum, useAlbumPhotos} from '../lib/ha/photos';
import {useWallScreen} from '../lib/ha/wall';
import {TRANSITION} from '../lib/motion/tokens';
import {GlassCard, NightFace, PhotoCarousel, RestClock, Ripples, RestWeather, useRipples} from '../ui/Rest';
import type {RestPhoto} from '../ui/Rest';
import {currentScreen, useNav} from './nav';
import type {ScreenId} from './nav';
import {RestMusic} from './rest-music';
import {useScreenSettings} from './screen-settings';
import {degrees} from './screens/Home';
import {useRobotWidget} from './screens/Robot';
import {useBridgeTimers, useTimerWidget} from './screens/Timers';
import {useVehicleWidget} from './screens/Vehicle';
import {useHaWeather} from './screens/Weather';

export const IDLE_MS = 180_000;
// The photos Ro shows: the household's shared iCloud album through the PodVoice integration (lib/ha/photos.ts), read
// when Ro opens and every 15 minutes while it is up. Without an album (no link set, an older integration, nothing
// read yet) the panel's own photo is the album.
export const OWN_PHOTO: RestPhoto[] = [{src: 'ambient.webp', alt: 'Bjerglandskab ved en sø'}];

function useRestPhotos(): readonly RestPhoto[] {
  // Read when Ro is built (before its fade: the finger on »Ro«, or the idle timer). An answer equal to the cached
  // album changes nothing (the query shares its structure), so the fade is never re-rendered by it.
  const {data} = usePhotoAlbum(true);
  return useAlbumPhotos(data) ?? OWN_PHOTO;
}

// The wall's Automatisk dæmpning lives in the integration (it dims the screen at 21:00); the panel's own copy
// (screen-settings.ts, for Ro's night screen) follows it.
function useWallSettingsSync() {
  const {data} = useWallScreen();
  const serverDim = data?.auto_dim;
  useEffect(() => {
    if (serverDim !== undefined && useScreenSettings.getState().autoDim !== serverDim) {
      useScreenSettings.getState().setAutoDim(serverDim);
    }
  }, [serverDim]);
}
const ACTIVITY = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'] as const;
const DRIFT: [number, number][] = [[0, 0], [4, 0], [0, 4], [-4, 0], [0, -4]];

interface RestState {
  active: boolean;
  /** Woken from the night screen to Foto-Ro (until three quiet minutes pass). */
  awake: boolean;
  /** Ro is built ahead, unseen: the finger is on the »Ro« key. */
  warm: boolean;
  /** Ro is still on screen, fading out after a wake. */
  leaving: boolean;
  // The topbar's »Ro« key (moon) and the idle timer.
  enter: () => void;
  wake: () => void;
  prewarm: () => void;
}

export const useRest = create<RestState>(set => ({
  active: false,
  awake: false,
  warm: false,
  leaving: false,
  enter: () => {
    set({active: true, awake: false, warm: false, leaving: true});
  },
  wake: () => {
    set({active: false, awake: false});
  },
  prewarm: () => {
    set(state => (state.active || state.warm ? state : {warm: true}));
  },
}));

// How long Ro stays built without its tap after the finger landed on »Ro«.
const WARM_MS = 3000;
// The longest a fade in waits for the photo to be decoded.
const DECODE_MS = 150;
// Ro out of sight is drawn at .001, never 0 (WebKit keeps its pixels; the fade in repaints nothing).
const WAITING = 0.001;

export const enterRest = () => {
  useRest.getState().enter();
};

const zone = 'Europe/Copenhagen';
export function restClock(now: Date) {
  const time = now.toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit', timeZone: zone});
  const date = now.toLocaleDateString('da-DK', {weekday: 'long', day: 'numeric', month: 'long', timeZone: zone});
  const hours = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hourCycle: 'h23', timeZone: zone});
  const hour = Number(hours.format(now));
  return {time, date, night: hour >= 21 || hour < 7};
}

// The minute, read again just after it changes.
function useMinute(): Date {
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
  return now;
}

// Rest after IDLE_MS without activity, unless the page is busy; any activity starts the wait again.
function useIdle(busy: boolean) {
  const enter = useRest(state => state.enter);
  const active = useRest(state => state.active);
  useEffect(() => {
    if (busy || active) return;
    const doc = document;
    let handle = 0;
    const arm = () => {
      window.clearTimeout(handle);
      if (doc.visibilityState === 'hidden') return;
      handle = window.setTimeout(() => {
        const typing = doc.activeElement?.matches('input,textarea,select,[contenteditable=true]') === true;
        if (doc.visibilityState === 'hidden' || typing) arm();
        else enter();
      }, IDLE_MS);
    };
    for (const type of ACTIVITY) doc.addEventListener(type, arm, {capture: true, passive: true});
    doc.addEventListener('visibilitychange', arm);
    arm();
    return () => {
      window.clearTimeout(handle);
      for (const type of ACTIVITY) doc.removeEventListener(type, arm, {capture: true});
      doc.removeEventListener('visibilitychange', arm);
    };
  }, [busy, active, enter]);
}

// The activity slot (A-FotoRo, overview-activity-model): a running timer first, else the robot cleaning, on its
// way home or in fault, else the car charging. A tap opens its page; it has no key of its own (owner, 13 Nov).
function Activity({onOpen}: {onOpen: (screen: ScreenId) => void}) {
  const timer = useTimerWidget();
  const robot = useRobotWidget();
  const car = useVehicleWidget();
  if (timer.state === 'koerer' || timer.state === 'pause' || timer.state === 'faerdig') {
    return (
      <GlassCard data-rest-activity="timer" chip={{glyph: 'timer', surface: 'bg-pv-ink', ink: 'text-pv-timer-accent'}}
        // Done, the primary line already says »Tiden er gået« (Timer-faerdig): the context is only the timer's name.
        prim={timer.prim} ctx={timer.state === 'faerdig' ? timer.name ?? 'Timer'
          : `${timer.name ?? 'Timer'} · ${timer.state === 'pause' ? 'på pause' : 'tæller ned'}`}
        label={`Åbn Timer · ${timer.prim}`} opens="timers" onOpen={() => { onOpen('timers'); }} />
    );
  }
  if (robot && (robot.state === 'rengoer' || robot.state === 'tilbasen' || robot.state === 'fejl')) {
    return (
      <GlassCard data-rest-activity="robot" chip={{glyph: 'robot', surface: 'bg-pv-robot'}} prim={robot.prim}
        ctx={['Robotstøvsuger', robot.battery].filter(Boolean).join(' · ')} label={`Åbn Robotstøvsuger · ${robot.prim}`}
        opens="robot" onOpen={() => { onOpen('robot'); }} />
    );
  }
  if (car?.state === 'lader') {
    return (
      <GlassCard data-rest-activity="vehicle" chip={{glyph: 'car', surface: 'bg-pv-tesla'}} prim={car.prim}
        ctx={['Tesla', car.ctx].filter(Boolean).join(' · ')} label={`Åbn Tesla · ${car.prim}`} opens="vehicle"
        onOpen={() => { onOpen('vehicle'); }} />
    );
  }
  return null;
}

function Day({onWake, onOpen, shown}: {onWake: () => void; onOpen: (screen: ScreenId) => void; shown: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const now = useMinute();
  const {time, date} = restClock(now);
  const {model} = useHaWeather();
  const {ripples, pressed} = useRipples();
  const photos = useRestPhotos();
  // One drift step per minute.
  const [x, y] = DRIFT[Math.floor(now.getTime() / 60_000) % DRIFT.length] ?? [0, 0];
  const current = model.current;
  return (
    <div className="relative isolate size-full overflow-hidden text-white" data-rest="day"
      onPointerDown={pressed}>
      {/* No step while Ro is built ahead unseen; once shown the first step is 20 s away, never inside the fade (the
          next photo was fetched when Ro was built). */}
      <PhotoCarousel photos={photos} still={!shown} />
      <span id="photo-view-description" className="sr-only">
        Åbn dagens overblik
      </span>
      {/* The whole photo wakes the panel; the cards over it are their own presses. */}
      <Button id="photo-view" aria-label="Tryk for at åbne hjemmet" aria-describedby="photo-view-description"
        className="absolute inset-0 cursor-pointer outline-none [-webkit-tap-highlight-color:transparent]"
        onPress={onWake} />
      <motion.span className="pointer-events-none absolute top-9 left-12" initial={false}
        animate={{transform: `translate3d(${String(x)}px, ${String(y)}px, 0)`}}
        transition={reduced ? {duration: 0} : {duration: 2, ease: 'easeInOut'}}>
        <RestClock time={time} date={date} />
      </motion.span>
      {current ? (
        <span className="pointer-events-none absolute top-11 right-12">
          <RestWeather temperature={degrees(current.temperature)} condition={current.condition} />
        </span>
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-3.5 text-center text-[15px]
        [text-shadow:0_1px_10px_rgba(0,0,0,.45)]" aria-hidden="true">
        Tryk for at åbne hjemmet
      </span>
      <div className="absolute bottom-10 left-10 flex flex-col gap-3">
        <Activity onOpen={onOpen} />
      </div>
      <div className="absolute right-10 bottom-10">
        <RestMusic />
      </div>
      <Ripples ripples={ripples} />
    </div>
  );
}

// Foto-Nat: a tap wakes Foto-Ro.
function Night({onWake}: {onWake: () => void}) {
  const now = useMinute();
  const {time} = restClock(now);
  const {model} = useHaWeather();
  const timer = useTimerWidget();
  const {ripples, pressed} = useRipples();
  const current = model.current;
  const sub = current ? `${degrees(current.temperature)} · ${current.condition}` : '';
  return (
    <div className="relative size-full overflow-hidden bg-black" data-rest="night" onPointerDown={pressed}>
      <Button id="photo-view" aria-label="Vis Foto-Ro" className="absolute inset-0 cursor-pointer outline-none
        [-webkit-tap-highlight-color:transparent]" onPress={onWake} />
      <span className="pointer-events-none">
        <NightFace time={time} sub={sub}
          timer={timer.state === 'koerer' || timer.state === 'pause' ? `${timer.name ?? 'Timer'} · ${timer.prim}`
            : null} />
      </span>
      <Ripples ripples={ripples} tone="night" />
    </div>
  );
}

// Ro over the panel. It is built before it shows (the finger on »Ro«, or the idle timer) and drawn unseen until its
// photo is decoded; then it cross-fades in on the navigation spring, and out again on a wake. Only its opacity changes
// on the way (a motion value, no render), and its glass cards have no live backdrop blur while it moves or waits
// (data-moving, GlassCard). It is a target only while shown.
function Rested({shown, onWake, onOpen}: {shown: boolean; onWake: () => void; onOpen: (screen: ScreenId) => void}) {
  const reduced = useReducedMotion() ?? false;
  const overlay = useRef<HTMLDivElement>(null);
  const opacity = useMotionValue(WAITING);
  const now = useMinute();
  const autoDim = useScreenSettings(state => state.autoDim);
  const night = autoDim && restClock(now).night;
  const awake = useRest(state => state.awake);
  const showNight = night && !awake;
  // Woken at night, Foto-Ro stands for three quiet minutes, then the night screen returns.
  useEffect(() => {
    if (!night || !awake) return;
    let handle = 0;
    const arm = () => {
      window.clearTimeout(handle);
      handle = window.setTimeout(() => {
        useRest.setState({awake: false});
      }, IDLE_MS);
    };
    arm();
    for (const type of ACTIVITY) document.addEventListener(type, arm, {capture: true, passive: true});
    return () => {
      window.clearTimeout(handle);
      for (const type of ACTIVITY) document.removeEventListener(type, arm, {capture: true});
    };
  }, [night, awake]);
  // Ready once its photo is decoded and its first frame painted (from when it is built, usually the finger landing on
  // »Ro«): a fade in starts then, or at once when it already is.
  const [ready] = useState(() => {
    let done: () => void = () => undefined;
    const promise = new Promise<void>(resolve => {
      done = resolve;
    });
    return {promise, done, is: false};
  });
  useEffect(() => {
    const node = overlay.current;
    if (!node) return;
    let first = 0, second = 0;
    const images = [...node.querySelectorAll('img')].map(image =>
      typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve());
    const decoded = Promise.race([Promise.all(images), new Promise(resolve => setTimeout(resolve, DECODE_MS))]);
    void decoded.then(() => {
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          ready.is = true;
          ready.done();
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [ready]);
  useLayoutEffect(() => {
    const node = overlay.current;
    if (!node) return;
    let cancelled = false;
    let leave = 0;
    let move: ReturnType<typeof animate> | null = null;
    const transition = reduced ? TRANSITION.reduced : {...TRANSITION.nav, restDelta: 0.001};
    node.dataset.moving = 'true';
    const go = (target: number) => {
      if (cancelled) return;
      move = animate(opacity, target, transition);
      void move.finished.then(() => {
        if (cancelled || opacity.get() !== target) return;
        if (target === 1) delete node.dataset.moving;
        // Faded out: let go a moment later, never in the frames right after the fade.
        else leave = window.setTimeout(() => {
          useRest.setState({leaving: false});
        }, WARM_MS);
      }, () => undefined);
    };
    if (!shown) {
      // Waiting unseen (prewarmed) or fading out.
      if (opacity.get() > WAITING) go(WAITING);
    } else if (ready.is || opacity.get() > WAITING) go(1);
    else void ready.promise.then(() => {
      go(1);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(leave);
      move?.stop();
    };
  }, [shown, reduced, opacity, ready]);
  return (
    <motion.div
      ref={overlay}
      // Its own compositing layer from the moment it is built (will-change), so the fade only changes opacity.
      className="group/rest fixed inset-0 z-[900] flex will-change-[opacity]"
      data-rest={showNight ? 'night' : 'day'}
      data-moving="true"
      aria-hidden={shown ? undefined : true}
      inert={!shown}
      style={{opacity, pointerEvents: shown ? 'auto' : 'none'}}
    >
      {showNight ? <Night onWake={() => { useRest.setState({awake: true}); }} />
        : <Day onWake={onWake} onOpen={onOpen} shown={shown} />}
    </motion.div>
  );
}

// Mounted once by the shell, under the timer alarm.
export function Rest() {
  const active = useRest(state => state.active);
  const warm = useRest(state => state.warm);
  const leaving = useRest(state => state.leaving);
  const wake = useRest(state => state.wake);
  // The finger on »Ro« builds Ro (and decodes its photo) before the tap; unused, it is let go again.
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-navigation="rest"]')) useRest.getState().prewarm();
    };
    window.addEventListener('pointerdown', down, {capture: true, passive: true});
    return () => {
      window.removeEventListener('pointerdown', down, {capture: true});
    };
  }, []);
  useEffect(() => {
    if (!warm) return;
    const handle = setTimeout(() => {
      useRest.setState({warm: false});
    }, WARM_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [warm]);
  const reading = useNav(state => currentScreen(state) === 'answers');
  const {timers} = useBridgeTimers();
  const ringing = timers.some(timer => timer.status === 'done');
  useIdle(ringing || reading);
  useWallSettingsSync();
  return (
    <>
      {active || warm || leaving ? (
        <Rested
          shown={active}
          onWake={() => {
            wake();
            useNav.getState().home();
          }}
          onOpen={screen => {
            wake();
            const nav = useNav.getState();
            nav.home();
            nav.push(screen);
          }}
        />
      ) : null}
    </>
  );
}
