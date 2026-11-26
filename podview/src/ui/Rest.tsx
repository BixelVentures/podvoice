// A-FotoRo and Foto-Nat's pieces (design canvas »PodView Retninger«): the photo carousel under its scrims, the
// 168-px clock with the date, the weather at the top right, the glass cards (notifications on the left, music always
// on the right; only music and radio have a play/pause/stop key, the rest keep the arrow), the tap ripple, and the
// night screen (black, the clock and the weather in dim warm red, a running timer as a dim pill, no photo, no cards,
// no animation). Presentational: the screen gives the words and the presses.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {LiveLine, Swap} from '../lib/motion/swap';
import {pressable} from './Button';
import {Glyph} from './glyphs';
import type {FilledName, GlyphName} from './glyphs';
import {tapOnly} from './tap';
import {cx} from './tv';

// The canvas's text shadow on the photo.
const SHADOW = '[text-shadow:0_1px_10px_rgba(0,0,0,.45)]';

export interface RestPhoto {
  src: string;
  alt: string;
  /** When it was taken or added (ms): the newest come first. */
  at?: number;
}

/** The carousel's order (decided 11 Nov): newest first, then the rest at random, none repeated in a round. */
export function carouselOrder(photos: readonly RestPhoto[], random: () => number = Math.random): RestPhoto[] {
  if (photos.length < 2) return [...photos];
  const sorted = [...photos].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const [newest, ...rest] = sorted;
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = rest[i];
    const b = rest[j];
    if (a && b) [rest[i], rest[j]] = [b, a];
  }
  return newest ? [newest, ...rest] : rest;
}

export const CAROUSEL_MS = 20_000;
export const CROSSFADE_S = 1.2;

function Photo({photo, dim, onFail}: {photo: RestPhoto; dim: boolean; onFail: () => void}) {
  const [portrait, setPortrait] = useState(false);
  const image = cx('pointer-events-none absolute inset-0 size-full max-w-none', dim && 'brightness-25 saturate-60');
  return (
    <>
      {/* A portrait photo stands whole on a blurred, darkened copy of itself. */}
      {portrait ? <img className={cx(image, 'scale-110 object-cover blur-2xl brightness-75')} src={photo.src} alt=""
        aria-hidden="true" decoding="async" /> : null}
      <img
        className={cx(image, portrait ? 'object-contain' : 'object-cover')}
        src={photo.src}
        alt={photo.alt}
        decoding="async"
        onLoad={event => {
          const {naturalWidth: width, naturalHeight: height} = event.currentTarget;
          setPortrait(height > width);
        }}
        onError={onFail}
      />
    </>
  );
}

/**
 * The photo carousel: one photo every 20 s with a 1.2-s crossfade, in carouselOrder. A photo that cannot be loaded
 * (offline) is skipped and the last one shown stays, with no error; without any photo the dark ink shows.
 */
export function PhotoCarousel({photos, dim = false, still = false}: {photos: readonly RestPhoto[]; dim?: boolean;
  still?: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const [order, setOrder] = useState(() => carouselOrder(photos));
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const key = photos.map(photo => photo.src).join('\n');
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    setOrder(carouselOrder(photos));
    setAt(0);
    // Only a new album reorders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const usable = order.filter(photo => !failed.has(photo.src));
  useEffect(() => {
    if (still || usable.length < 2) return;
    const timer = window.setTimeout(() => {
      // A round ends: a new random round (the newest first again).
      if (at + 1 >= usable.length) {
        setOrder(carouselOrder(photos));
        setAt(0);
      } else setAt(at + 1);
    }, CAROUSEL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [at, usable.length, still, photos]);
  const photo = usable[Math.min(at, usable.length - 1)] ?? null;
  return (
    <div className="pointer-events-none absolute inset-0 -z-2 overflow-hidden bg-pv-ink" aria-hidden={!photo}>
      {/* A photo that cannot be loaded leaves at once (no fade of a broken picture); the next crossfades in. */}
      {photo ? (
        <AnimatePresence initial={false}>
          <motion.div key={photo.src} className="absolute inset-0" initial={{opacity: 0}} animate={{opacity: 1}}
            exit={{opacity: 0}} transition={{duration: reduced ? 0.15 : CROSSFADE_S, ease: 'easeInOut'}}>
            <Photo photo={photo} dim={dim} onFail={() => {
              setFailed(current => new Set(current).add(photo.src));
            }} />
          </motion.div>
        </AnimatePresence>
      ) : null}
      {/* The canvas's scrims: darker at the top (the clock) and the bottom (the cards). */}
      <i className="absolute inset-x-0 top-0 block h-[280px] bg-linear-to-b from-black/42 to-transparent" />
      <i className="absolute inset-x-0 bottom-0 block h-[260px] bg-linear-to-t from-black/35 to-transparent" />
    </div>
  );
}

/** The clock block at 48/36: »14.30« at 168 px and the date under it. */
export function RestClock({time, date, className}: {time: string; date: string; className?: string}) {
  return (
    <span className={cx('flex flex-col text-white', SHADOW, className)}>
      <span id="photo-clock" className="text-[168px] leading-[.9] font-semibold tracking-[-0.05em] tabular-nums">
        {time}
      </span>
      <span id="photo-date" className="mt-2.5 text-[26px] leading-8 font-semibold">{date}</span>
    </span>
  );
}

/** The weather at the top right: the temperature at 44 px over the condition. */
export function RestWeather({temperature, condition}: {temperature: string; condition: string}) {
  return (
    <span className={cx('flex flex-col items-end text-white', SHADOW)} data-rest-weather="">
      <span className="text-[44px] leading-[54px] font-semibold tracking-[-0.03em]">{temperature}</span>
      <span className="text-[18px] leading-6">{condition}</span>
    </span>
  );
}

export interface GlassCardProps {
  /** The 48-px chip: a glyph on a colour (a bg-* class and the glyph's text-* colour), or a picture (cover/logo). */
  chip: {glyph: GlyphName; surface: string; ink?: string} | {picture: string};
  prim: string;
  ctx: string;
  /** Opens the card's page (the card's own press). */
  label: string;
  onOpen: () => void;
  opens?: string;
  /** Music and radio only: the round key (pause/play or stop/play); the rest keep the arrow. */
  control?: {icon: FilledName; label: string; onPress: () => void; busy?: boolean; disabled?: boolean} | null;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

/** A glass card (340×80, radius 24): the chip, two lines, then the key or the arrow. */
export function GlassCard({chip, prim, ctx, label, onOpen, opens, control, className, ...data}: GlassCardProps) {
  return (
    <div {...data} className={cx('box-border flex h-20 w-[340px] items-center gap-3 rounded-pv-widget',
      'bg-pv-surface/88 pr-4 pl-5 text-pv-ink shadow-[0_18px_40px_-20px_rgba(0,0,0,.55)] backdrop-blur-[18px]',
      className)}>
      <AriaButton
        className={cx(pressable, 'flex h-20 min-w-0 flex-1 items-center gap-4 text-left text-pv-ink',
          'data-[pressed]:scale-[.97] data-[pressed]:brightness-[.92]')}
        aria-label={label}
        {...(opens ? {'data-opens': opens} : {})}
        onPress={tapOnly(onOpen)}
      >
        {'picture' in chip ? (
          // A new cover or logo cross-fades over the old one in its place.
          <span className="relative size-12 flex-none">
            <Swap swapKey={chip.picture} kind="fade" className="block size-12" out="absolute inset-0">
              <img className="block size-12 rounded-[14px] object-cover" src={chip.picture} alt="" decoding="async"
                draggable={false} />
            </Swap>
          </span>
        ) : (
          <span className={cx('grid size-12 flex-none place-items-center rounded-[14px]', chip.surface,
            chip.ink ?? 'text-pv-ink')} aria-hidden="true">
            <Glyph name={chip.glyph} size={24} stroke={1.8} />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="relative truncate text-[20px] leading-[26px] font-extrabold tabular-nums">
            <LiveLine text={prim} className="block truncate" />
          </span>
          <span className="relative truncate text-[15px] leading-5 text-pv-ink-2">
            <LiveLine text={ctx} className="block truncate" />
          </span>
        </span>
      </AriaButton>
      {control ? (
        <AriaButton
          className={cx(pressable, 'relative grid size-[52px] flex-none place-items-center rounded-full bg-pv-ink',
            'text-pv-on-dark data-[pressed]:scale-[.97] data-[pressed]:brightness-[.92] data-[disabled]:opacity-45')}
          aria-label={control.label}
          isDisabled={control.disabled ?? false}
          data-busy={control.busy ? 'true' : undefined}
          onPress={tapOnly(control.onPress)}
        >
          {/* Pause and play swap inside the same key (a quick scale and fade). */}
          <Swap swapKey={control.icon} kind="icon" className="grid place-items-center"
            out="absolute inset-0 grid place-items-center">
            <Glyph name={control.icon} size={20} />
          </Swap>
        </AriaButton>
      ) : (
        <Glyph name="chevron" size={18} stroke={2.2} className="flex-none" />
      )}
    </div>
  );
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

/**
 * The tap ripple (A-FotoRo, Foto-Nat): a soft circle at the finger (300 ms, scale .2 → 1.6, fading), at most three
 * at once; a reduced-motion user gets none. `pressed` goes on the surface's onPointerDown.
 */
export function useRipples(): {pressed: (event: ReactPointerEvent<HTMLElement>) => void; ripples: Ripple[]} {
  const reduced = useReducedMotion() ?? false;
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const next = useRef(0);
  return {
    ripples,
    pressed: event => {
      if (reduced) return;
      const box = event.currentTarget.getBoundingClientRect();
      next.current += 1;
      const ripple = {id: next.current, x: Math.round(event.clientX - box.left), y: Math.round(event.clientY - box.top)};
      setRipples(current => [...current.slice(-2), ripple]);
    },
  };
}

export function Ripples({ripples, tone = 'light'}: {ripples: Ripple[]; tone?: 'light' | 'night'}) {
  return ripples.map(ripple => (
    <motion.i
      key={ripple.id}
      aria-hidden="true"
      className={cx('pointer-events-none absolute -mt-20 -ml-20 block size-40 rounded-full',
        tone === 'night' ? 'bg-[radial-gradient(circle,rgba(107,58,44,.6),rgba(107,58,44,0)_70%)]'
          : 'bg-[radial-gradient(circle,rgba(255,255,255,.55),rgba(255,255,255,0)_70%)]')}
      style={{left: ripple.x, top: ripple.y}}
      initial={{scale: 0.2, opacity: 1}}
      animate={{scale: 1.6, opacity: 0}}
      transition={{duration: 0.3, ease: 'easeOut'}}
    />
  ));
}

/** Foto-Nat: black, the clock and »6° · Klart« in dim warm red, a running timer as a dim pill; nothing moves. */
export function NightFace({time, sub, timer, children}: {time: string; sub: string; timer?: string | null;
  children?: ReactNode}) {
  return (
    <>
      <span className="absolute inset-x-0 top-[310px] flex flex-col items-center text-pv-night">
        <span id="photo-clock" className="text-[168px] leading-[.9] font-medium tracking-[-0.05em] tabular-nums">
          {time}
        </span>
        <span className="mt-3.5 text-[22px] leading-7 text-pv-night-2">{sub}</span>
      </span>
      {timer ? (
        <span className="absolute bottom-14 left-1/2 flex h-11 -translate-x-1/2 items-center gap-2.5 rounded-[22px]
          px-[18px] text-[18px] text-pv-night tabular-nums shadow-[inset_0_0_0_1.5px_var(--color-pv-night-3)]">
          {timer}
        </span>
      ) : null}
      {children}
    </>
  );
}
