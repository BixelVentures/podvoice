// Ro (Foto-Ro) on the panel: after three minutes without a touch,
// key or scroll the panel rests in Ro: the photo with the clock and the date over it, »Tryk for at åbne hjemmet«.
// A tap wakes it to Hjem. It does not rest while a timer has finished (the alarm is up), while Svar is open (an
// answer is being read), while a text field has focus or while the page is hidden. At night (21–07, Copenhagen) the
// photo dims and only the clock stays. The photo is ambient.webp next to the panel's bundle; if it
// cannot be loaded, the fallback colour (--pv-screen-photo-fallback) is shown. The clock
// drifts 4 px a minute so the panel never burns in. Ro's music button (rest-music.tsx) sits at the bottom right.
// Motion: opacity and transform only (compositor).
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useState} from 'react';
import {create} from 'zustand';
import {TRANSITION} from '../lib/motion/tokens';
import {currentScreen, useNav} from './nav';
import {RestMusic} from './rest-music';
import {useBridgeTimers} from './screens/Timers';

export const IDLE_MS = 180_000;
// Ro's clock block (styles/kit.css, rest view): 48 from the left, 36 from the top, on the dark ink.
const TIME_CLASS =
  'photo-time absolute top-[36px] left-[48px] flex flex-col gap-[var(--pv-s2)] text-[var(--pv-on-dark)]';
const ACTIVITY = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'] as const;
const DRIFT: [number, number][] = [[0, 0], [4, 0], [0, 4], [-4, 0], [0, -4]];

interface RestState {
  active: boolean;
  // The topbar's »Ro« key (moon) and the idle timer.
  enter: () => void;
  wake: () => void;
}

export const useRest = create<RestState>(set => ({
  active: false,
  enter: () => {
    set({active: true});
  },
  wake: () => {
    set({active: false});
  },
}));

export const enterRest = () => {
  useRest.getState().enter();
};

const zone = 'Europe/Copenhagen';
export function restClock(now: Date) {
  const time = now.toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit', timeZone: zone}).replace('.', ':');
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

function Photo({onWake}: {onWake: () => void}) {
  const reduced = useReducedMotion() ?? false;
  const now = useMinute();
  const [photo, setPhoto] = useState(true);
  const {time, date, night} = restClock(now);
  // One drift step per minute.
  const [x, y] = DRIFT[Math.floor(now.getTime() / 60_000) % DRIFT.length] ?? [0, 0];
  return (
    <motion.div
      className="fixed inset-0 z-[900] flex"
      data-rest={night ? 'night' : 'day'}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
    >
      <button
        id="photo-view"
        type="button"
        className="photo-view !m-0 !h-full !rounded-none !p-0"
        data-pv-press="none"
        aria-description="Åbn dagens overblik"
        style={night ? {background: 'var(--pv-ink)'} : undefined}
        onClick={onWake}
      >
        {photo ? (
          <img
            src="ambient.webp"
            decoding="async"
            alt="Bjerglandskab ved en sø"
            style={night ? {filter: 'brightness(.25) saturate(.6)'} : undefined}
            onError={() => {
              setPhoto(false);
            }}
          />
        ) : null}
        <motion.span
          className={TIME_CLASS}
          initial={false}
          animate={{transform: `translate3d(${String(x)}px, ${String(y)}px, 0)`}}
          transition={reduced ? {duration: 0} : {duration: 2, ease: 'easeInOut'}}
        >
          <span id="photo-clock">
            {time}
          </span>
          <span id="photo-date" className="font-semibold" hidden={night}>
            {date}
          </span>
        </motion.span>
        <span className="photo-caption absolute right-0 bottom-[14px] left-0 !block text-center" hidden={night}>
          Tryk for at åbne hjemmet
        </span>
      </button>
      <RestMusic night={night} />
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
  return (
    <AnimatePresence>
      {active ? (
        <Photo
          key="rest"
          onWake={() => {
            wake();
            useNav.getState().home();
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}
