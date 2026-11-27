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
import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react';
import {useEffect, useState} from 'react';
import {Button} from 'react-aria-components';
import {create} from 'zustand';
import {usePhotoAlbum, useAlbumPhotos} from '../lib/ha/photos';
import {useWallScreen} from '../lib/ha/wall';
import {TRANSITION} from '../lib/motion/tokens';
import {GlassCard, NightFace, PhotoCarousel, RestClock, Ripples, RestWeather, useRipples} from '../ui/Rest';
import type {CarouselRound, RestPhoto} from '../ui/Rest';
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

// The album as Ro shows it: the album's photos when it has any, the panel's own photo when it has none (no link, an
// older integration, a read that failed), and no photo (the dark ink) before the panel's very first answer, so the
// stock photo never shows before the album. Ro never waits for a read: the album is read when the panel starts
// (PhotosPrefetch) and kept in the query cache, so Ro opens on it.
function useRestPhotos(): readonly RestPhoto[] {
  const {data, status} = usePhotoAlbum(true);
  const album = useAlbumPhotos(data);
  if (album) return album;
  return data || status === 'error' ? OWN_PHOTO : NO_PHOTOS;
}
const NO_PHOTOS: readonly RestPhoto[] = [];

// Ro resumes where it was: the carousel's round (its order and the photo on screen) is kept here while Ro is away
// (not over a reload), so Ro opens again on the photo it showed, with that photo's 20 s from zero, and goes on in
// the same order. The photo it opens on is decoded ahead (new Image() + decode()) whenever the album changes and
// whenever Ro closes, so it appears at once, with no hidden layer and no wait.
const opening = {photos: OWN_PHOTO as readonly RestPhoto[], round: null as CarouselRound | null,
  decoded: new Set<string>()};
const photoKey = (photo: RestPhoto) => photo.id ?? photo.src;
export function openingPhoto(photos: readonly RestPhoto[] = opening.photos,
  round: CarouselRound | null = opening.round): RestPhoto | null {
  const current = round?.order[round.at];
  const kept = current ? photos.find(photo => photoKey(photo) === photoKey(current)) : undefined;
  return kept ?? [...photos].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
}
/** The kept round (tests). */
export const restRound = () => opening.round;
/** Forget the kept round (tests). */
export function resetRestRound() {
  opening.round = null;
}
export function decodePhoto(src: string): Promise<void> {
  if (opening.decoded.has(src) || typeof Image === 'undefined') return Promise.resolve();
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  const done = typeof image.decode === 'function' ? image.decode() : new Promise<void>((resolve, reject) => {
    image.onload = () => { resolve(); };
    image.onerror = () => { reject(new Error('photo')); };
  });
  return done.then(() => {
    opening.decoded.add(src);
  }, () => undefined);
}
function decodeOpening() {
  const photo = openingPhoto();
  return photo ? decodePhoto(photo.src) : Promise.resolve();
}

// The album is read when the panel starts (and kept: Ro reads it again while it is open), and Ro's first photo is
// decoded as soon as it is known.
export function PhotosPrefetch() {
  const photos = useRestPhotos();
  useEffect(() => {
    opening.photos = photos;
    void decodeOpening();
  }, [photos]);
  return null;
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
  /** Ro is shown (mounted only then). */
  active: boolean;
  /** Woken from the night screen to Foto-Ro (until three quiet minutes pass). */
  awake: boolean;
  // The topbar's »Ro« key (moon) and the idle timer.
  enter: () => void;
  wake: () => void;
}

// The longest Ro's opening waits for its first photo to be decoded (it usually already is: PhotosPrefetch).
export const OPEN_WAIT_MS = 200;
let opens = 0;

export const useRest = create<RestState>(set => ({
  active: false,
  awake: false,
  enter: () => {
    const ticket = ++opens;
    let done = false;
    const open = () => {
      if (done || ticket !== opens) return;
      done = true;
      set({active: true, awake: false});
    };
    const photo = openingPhoto();
    if (!photo || opening.decoded.has(photo.src)) {
      open();
      return;
    }
    void decodeOpening().then(open);
    setTimeout(open, OPEN_WAIT_MS);
  },
  wake: () => {
    opens += 1;
    set({active: false, awake: false});
  },
}));

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

// The minute: a setInterval aligned to the minute (started just after it changes), for as long as Ro is mounted.
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval = 0;
    const tick = () => {
      setNow(new Date());
    };
    const align = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    return () => {
      window.clearTimeout(align);
      window.clearInterval(interval);
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

function Day({onWake, onOpen}: {onWake: () => void; onOpen: (screen: ScreenId) => void}) {
  const photos = useRestPhotos();
  // Resumed on the round Ro left (decoded ahead); every step is kept for the next opening.
  const [resume] = useState(() => opening.round);
  const reduced = useReducedMotion() ?? false;
  const now = useMinute();
  const {time, date} = restClock(now);
  const {model} = useHaWeather();
  const {ripples, pressed} = useRipples();
  // One drift step per minute.
  const [x, y] = DRIFT[Math.floor(now.getTime() / 60_000) % DRIFT.length] ?? [0, 0];
  const current = model.current;
  return (
    <div className="relative isolate size-full overflow-hidden text-white" data-rest="day"
      onPointerDown={pressed}>
      <PhotoCarousel photos={photos} resume={resume} onRound={round => {
        if (round.order.length > 0) opening.round = round;
      }} />
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

// Ro over the panel: a plain full-screen overlay, mounted only while Ro is shown. It fades in on the navigation
// spring and out again on a wake, then unmounts. By construction it can never lock the panel: while it is mounted
// and present every tap reaches it (and a tap anywhere but its cards wakes the panel), and from the moment it starts
// to leave it takes no taps at all (pointer-events none, inert), whether or not its fade ever finishes.
function Rested({onWake, onOpen}: {onWake: () => void; onOpen: (screen: ScreenId) => void}) {
  const reduced = useReducedMotion() ?? false;
  const present = useIsPresent();
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
  // Moving (its fade in or out): its glass cards have no live backdrop blur (GlassCard).
  const [moving, setMoving] = useState(!reduced);
  const transition = reduced ? TRANSITION.reduced : TRANSITION.nav;
  return (
    <motion.div
      className="group/rest fixed inset-0 z-[900] flex will-change-[opacity]"
      data-rest={showNight ? 'night' : 'day'}
      data-moving={moving || !present ? 'true' : undefined}
      data-place={present ? 'center' : 'leaving'}
      aria-hidden={present ? undefined : true}
      inert={!present}
      style={{pointerEvents: present ? 'auto' : 'none'}}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={transition}
      onAnimationComplete={() => {
        if (present) setMoving(false);
      }}
    >
      {showNight ? <Night onWake={() => { useRest.setState({awake: true}); }} />
        : <Day onWake={onWake} onOpen={onOpen} />}
    </motion.div>
  );
}

// Mounted once by the shell, under the timer alarm.
export function Rest() {
  const active = useRest(state => state.active);
  const wake = useRest(state => state.wake);
  const reading = useNav(state => currentScreen(state) === 'answers');
  const {timers} = useBridgeTimers();
  const ringing = timers.some(timer => timer.status === 'done');
  useIdle(ringing || reading);
  useWallSettingsSync();
  // Closed: the photo it showed last is decoded again for the next opening (the browser may have let it go).
  useEffect(() => {
    if (!active) void decodeOpening();
  }, [active]);
  return (
    <AnimatePresence>
      {active ? (
        <Rested
          key="rest"
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
    </AnimatePresence>
  );
}
