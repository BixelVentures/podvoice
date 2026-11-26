// A-Player, the room's player column (372×692; the design canvas's A-Player and Player-* boards). At the top the
// room key (»Køkkenalrum ⌄«: where the music is chosen), then by mode: `mine` (the cover, track, progress,
// transport and volume), `away` (your music on another device, »Flyt hertil«), `other` (another account plays here:
// shown, never controlled), `radio` (the station live), `idle` (nothing playing: »Vælg musik«) and `offline` (the
// music cannot be reached: »Prøv igen«). The cover's tone lights the column softly from behind (still with reduced
// motion). Presentational: every press is the caller's.
import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {useState} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {Button, pressable} from './Button';
import {GLYPH, Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {Slider} from './Slider';
import {cx} from './tv';

export type PlayerMode = 'mine' | 'away' | 'other' | 'radio' | 'idle' | 'offline';

export interface IdleRow {
  title: string;
  sub: string;
  cover?: string | null;
  /** What a tap does (»Afspil Pop Remix«). */
  label: string;
  busy?: boolean;
  onPress: () => void;
}

export interface PlayerProps {
  mode: PlayerMode;
  /** The room key at the top: its label, accessible name and press (none: it cannot be chosen here). */
  picker: {label: string; 'aria-label': string; onPress?: () => void; icon?: GlyphName};
  title?: string;
  artist?: string;
  cover?: string | null;
  /** The cover's tone (#rrggbb): the soft light behind the cover and its shadow. */
  tone?: string | null;
  /** A short line under the artist (the speaker's own status when it is not simply playing or paused). */
  status?: string;
  progress?: {position: string; duration: string; fraction: number} | null;
  /** The timeline as a control (A5): the position in seconds of the duration; it follows the finger and seeks once
   *  on release. Without it the timeline only shows. */
  seek?: {value: number; max: number; disabled: boolean; onCommit: (seconds: number) => void} | null;
  playing?: boolean;
  /** The play/pause key's busy mark (a command in flight; the key stays enabled). */
  busy?: boolean;
  disabled?: boolean;
  onToggle?: (() => void) | null;
  onPrevious?: (() => void) | null;
  onNext?: (() => void) | null;
  onCover?: () => void;
  volume?: {value: number | null; disabled: boolean; onCommit: (value: number) => void;
    /** The speaker key: muted (cross, rail at 0) and its press (none: a plain mark). */
    muted?: boolean; onMute?: () => void} | null;
  /** Radio: the station, its logo and its live state. */
  radio?: {station: string; logo?: string | null; line: string; live: 'direkte' | 'forbinder' | 'stoppet'};
  /** Away: where your music plays, and moving it here. */
  away?: {device: string; moveLabel: string; onMove: () => void};
  /** Other, while your own music plays elsewhere (Player-Optaget): that track, and taking the speaker over. */
  takeOver?: {title: string; line: string; label: string; onPress: () => void} | null;
  /** Idle (Player-Tom, the »mellemting«): small rows under »Vælg musik« (»Til eftermiddagen«: one suggestion;
   *  »Hør igen«: two tracks), all alike; a group without rows is left out. */
  idleRows?: {label: string; rows: IdleRow[]}[];
  /** Idle, other and offline: their way on. */
  onFindMusic?: () => void;
  offline?: {note: string; retryLabel: string; onRetry: () => void};
  /** The product's own notice for the last press (a wish HA did not confirm). */
  notice?: ReactNode;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

// A #rrggbb mixed toward another colour (the canvas's cover-tone recipe).
export function mixTone(hex: string, to: string, t: number, alpha = 1) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `rgba(${String(channel(16))},${String(channel(8))},${String(channel(0))},${String(alpha)})`;
}

const TONE = /^#[0-9a-fA-F]{6}$/;

// The three slow lights behind the cover (blurred, .42), the cover's own colours as the canvas mixes them, drifting
// while it plays and never with reduced motion.
function Mood({tone, still}: {tone: string; still: boolean}) {
  const reduced = (useReducedMotion() ?? false) || still;
  const blobs = [
    {className: '-top-10 -left-[60px] size-[300px]', color: mixTone(tone, '#FFFFFF', 0.25),
      move: {x: [0, 70, 0], y: [0, 40, 0], scale: [1, 1.2, 1]}, duration: 18},
    {className: 'top-10 left-[150px] size-[280px]', color: mixTone(tone, '#E8A06A', 0.45),
      move: {x: [0, -60, 0], y: [0, 30, 0], scale: [1.1, 0.9, 1.1]}, duration: 22},
    {className: 'top-[220px] left-10 h-[220px] w-[260px]', color: mixTone(tone, '#2A3550', 0.35),
      move: {x: [0, 30, 0], y: [0, -50, 0], scale: [1, 1.25, 1]}, duration: 26},
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[470px] overflow-hidden
      [mask-image:linear-gradient(#000_45%,transparent)]" aria-hidden="true">
      {blobs.map(blob => (
        <motion.i key={blob.duration} className={cx('absolute block rounded-full opacity-[.42] blur-[44px]',
          blob.className)} style={{backgroundColor: blob.color, scale: blob.move.scale[0] ?? 1}}
          {...(reduced ? {} : {animate: blob.move,
            transition: {duration: blob.duration, ease: 'easeInOut', repeat: Infinity}})} />
      ))}
    </div>
  );
}

const ROUND = cx(pressable, 'flex size-14 items-center justify-center rounded-full text-pv-ink',
  'data-[pressed]:bg-pv-ink/7');
const PLAY = cx(pressable, 'flex size-20 items-center justify-center rounded-full bg-pv-ink text-pv-on-dark',
  'data-[busy=true]:opacity-90');

function Placeholder({glyph}: {glyph: 'disc' | 'offline'}) {
  return (
    <div className="mt-4 flex h-[220px] w-[324px] items-center justify-center rounded-2xl bg-pv-placeholder
      text-pv-grey"
      aria-hidden="true">
      <Glyph name={glyph} size={64} stroke={1.3} />
    </div>
  );
}

function Volume({volume}: {volume: NonNullable<PlayerProps['volume']>}) {
  const muted = volume.muted === true;
  const wave = muted ? GLYPH.mute : GLYPH.volumeWave;
  return (
    <div className="flex items-center gap-1">
      {/* The speaker is a 44×44 key (A-Player, comment 1117fa77): muted shows a cross, the rail dims to 0 and the
          level is the caller's to remember. Without onMute it is the plain mark it was. */}
      <AriaButton
        className={cx(pressable, '-ml-2.5 flex size-11 items-center justify-center rounded-full',
          muted ? 'text-pv-ink' : 'text-pv-ink-3', 'data-[disabled]:opacity-100')}
        aria-label={muted ? 'Slå lyd til' : 'Slå lyd fra'}
        aria-pressed={muted}
        isDisabled={!volume.onMute || volume.disabled}
        {...(volume.onMute ? {onPress: volume.onMute} : {})}
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={GLYPH.volume} />
          <path d={wave} />
        </svg>
      </AriaButton>
      <Slider className={cx('flex-1 transition-opacity duration-200', muted && 'opacity-45')} variant="player"
        label="Lydstyrke" value={muted ? 0 : volume.value === null ? null : Math.round(volume.value)}
        isDisabled={volume.disabled} format={value => `${String(value)} %`} onCommit={volume.onCommit} />
    </div>
  );
}

// A new track's title and artist cross-fade with a small rise: the old pair leaves upwards, out of the flow by its
// own class (never motion's popLayout, whose injected stylesheet restyles the page) and keeps its words in
// pseudo-elements, so the player's text is only ever the current track. The same track never redraws.
function TrackFace({title, artist, reduced}: {title: string; artist: string; reduced: boolean}) {
  const present = useIsPresent();
  const face = reduced ? {opacity: 0} : {opacity: 0, y: 8};
  return (
    <motion.div className={cx('flex min-w-0 flex-col', !present && 'pointer-events-none absolute inset-x-0 top-0')}
      aria-hidden={present ? undefined : true} initial={face} animate={{opacity: 1, y: 0}}
      exit={reduced ? {opacity: 0} : {opacity: 0, y: -8}}
      transition={reduced ? TRANSITION.reduced : {...TRANSITION.smooth, opacity: TRANSITION.fade}}>
      {present ? (
        <>
          <span className="truncate text-2xl leading-[1.15] font-extrabold tracking-[-0.02em]">{title}</span>
          <span className="truncate text-[17px] text-pv-ink-3" hidden={!artist}>{artist}</span>
        </>
      ) : (
        <>
          <span className="truncate text-2xl leading-[1.15] font-extrabold tracking-[-0.02em]
            before:content-[attr(data-text)]" data-text={title} />
          <span className="truncate text-[17px] text-pv-ink-3 before:content-[attr(data-text)]" data-text={artist}
            hidden={!artist} />
        </>
      )}
    </motion.div>
  );
}

function Track({title, artist, status}: {title: string; artist: string; status?: string}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="relative mt-7 flex min-w-0 flex-col">
      <AnimatePresence initial={false}>
        <TrackFace key={`${title}\u0000${artist}`} title={title} artist={artist} reduced={reduced} />
      </AnimatePresence>
      {status ? <span className="truncate text-[15px] text-pv-ink-3">{status}</span> : null}
    </div>
  );
}

interface CoverLayer {
  key: number;
  src: string | null;
  ready: boolean;
}

// The cover: a new one is decoded under the old, then fades in over it (canvas cv-in: .4 s from a 1.04 scale) and the
// old ones go once it stands; a new track never shows an empty frame between the two. Nothing moves on first paint.
function Cover({src}: {src: string | null | undefined}) {
  const reduced = useReducedMotion() ?? false;
  const cover = src ?? null;
  const [layers, setLayers] = useState<CoverLayer[]>([{key: 0, src: cover, ready: true}]);
  const top = layers.at(-1);
  if (top && top.src !== cover) setLayers([...layers, {key: top.key + 1, src: cover, ready: cover === null}]);
  const ready = (key: number) => {
    setLayers(current => current.map(layer => (layer.key === key ? {...layer, ready: true} : layer)));
  };
  const settle = (key: number) => {
    setLayers(current => (current.at(-1)?.key === key && current.length > 1 ? current.slice(-1) : current));
  };
  return (
    <>
      {layers.map(layer => {
        const first = layer.key === 0;
        const shown = layer.ready ? {opacity: 1, scale: 1} : {opacity: 0, scale: reduced ? 1 : 1.04};
        const props = {
          className: 'absolute inset-0 size-full',
          initial: first ? (false as const) : {opacity: 0, scale: reduced ? 1 : 1.04},
          animate: shown,
          transition: reduced ? TRANSITION.reduced : {type: 'tween' as const, duration: 0.4, ease: 'easeOut' as const},
          onAnimationComplete: () => {
            if (layer.ready) settle(layer.key);
          },
        };
        return layer.src ? (
          <motion.img key={layer.key} {...props} className={cx(props.className, 'object-cover')} src={layer.src}
            alt="" decoding="async" draggable={false} onLoad={() => {
              ready(layer.key);
            }} onError={() => {
              ready(layer.key);
            }} />
        ) : (
          <motion.span key={layer.key} {...props} className={cx(props.className,
            'flex items-center justify-center bg-pv-placeholder')}>
            <Glyph name="disc" size={88} stroke={1.3} />
          </motion.span>
        );
      })}
    </>
  );
}

// Play and pause swap glyphs inside the same key: a quick scale and fade, never a new control.
function PlayGlyph({name}: {name: 'play' | 'pause' | 'stop'}) {
  const reduced = useReducedMotion() ?? false;
  const swap = reduced ? {initial: {opacity: 0}, animate: {opacity: 1}, exit: {opacity: 0}}
    : {initial: {opacity: 0, scale: 0.6}, animate: {opacity: 1, scale: 1}, exit: {opacity: 0, scale: 0.6}};
  return (
    <span className="relative flex size-[26px] items-center justify-center">
      <AnimatePresence initial={false}>
        <motion.span key={name} className="absolute inset-0 flex items-center justify-center" {...swap}
          transition={reduced ? TRANSITION.reduced : {...TRANSITION.quick, opacity: TRANSITION.fade}}>
          <Glyph name={name} size={26} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Player(props: PlayerProps) {
  const {mode, picker, title = '', artist = '', cover, tone, status, progress, playing = false, busy = false,
    disabled = false, onToggle, onPrevious, onNext, onCover, volume, radio, away, onFindMusic, offline, notice,
    takeOver, className, idleRows, seek, ...data} = props;
  const shownTone = tone && TONE.test(tone) ? tone : null;
  const mood = shownTone && (mode === 'mine' || (mode === 'radio' && radio?.live !== 'stoppet'));
  const glow = shownTone ? mixTone(shownTone, '#17171A', 0.25, 0.6) : 'rgba(23,23,26,.45)';
  // The room key is always active when it has a press (G7 ruling: also while away or another account plays).
  const pickable = !!picker.onPress;
  const reduce = useReducedMotion() ?? false;
  return (
    <article
      {...data}
      className={cx('relative flex h-full w-full flex-col overflow-hidden rounded-pv-hero bg-pv-surface px-6 pt-5',
        'pb-6 font-pv text-pv-ink shadow-pv-edge group-data-[link=offline]/host:opacity-55', className)}
    >
      {mood ? <Mood tone={shownTone} still={!playing} /> : null}
      <AriaButton
        className={cx(pressable, 'relative flex h-11 items-center gap-2 self-center rounded-pv-pill px-3.5 text-lg',
          'font-bold data-[disabled]:opacity-100')}
        aria-label={picker['aria-label']}
        aria-haspopup={pickable ? 'dialog' : false}
        isDisabled={!pickable}
        {...(pickable && picker.onPress ? {onPress: picker.onPress} : {})}
      >
        <Glyph name={picker.icon ?? 'speaker'} size={16} />
        <span className="max-w-[260px] truncate">{picker.label}</span>
        {pickable ? <Glyph name="chevronDown" size={12} stroke={2.4} /> : null}
      </AriaButton>

      {mode === 'idle' || mode === 'offline' ? (
        <>
          <Placeholder glyph={mode === 'idle' ? 'disc' : 'offline'} />
          <span className="mt-4 text-[22px] font-extrabold tracking-[-0.02em]">
            {mode === 'idle' ? 'Vælg musik' : 'Forbindelsen mangler'}
          </span>
          {mode === 'offline' && offline ? (
            <span className="mt-1.5 text-[15px] text-pv-ink-3">{offline.note}</span>
          ) : null}
          {status ? <span className="mt-1.5 text-[15px] text-pv-ink-3">{status}</span> : null}
          {mode === 'idle' ? (idleRows ?? []).filter(group => group.rows.length).map((group, index) => (
            <div key={group.label} className={cx('flex flex-col', index ? 'mt-2.5' : 'mt-3')} role="group"
              aria-label={group.label}>
              <span className="text-[15px] font-semibold text-pv-ink-3">{group.label}</span>
              <div className="mt-1.5 flex flex-col gap-1">
                {group.rows.map(row => (
                  <AriaButton key={row.label} className={cx(pressable, 'grid h-14 grid-cols-[48px_minmax(0,1fr)]',
                    'items-center gap-3 rounded-lg text-left data-[busy=true]:opacity-60')}
                    aria-label={row.label} data-busy={row.busy ? 'true' : undefined} onPress={row.onPress}>
                    <span className="size-12 overflow-hidden rounded-lg bg-pv-placeholder text-pv-grey">
                      {row.cover ? <img className="size-full object-cover" src={row.cover} alt="" loading="lazy"
                        decoding="async" draggable={false} /> : (
                        <span className="flex size-full items-center justify-center"><Glyph name="music" size={22} />
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-base font-bold">{row.title}</span>
                      <span className="truncate text-[15px] text-pv-ink-3">{row.sub}</span>
                    </span>
                  </AriaButton>
                ))}
              </div>
            </div>
          )) : null}
          <div className="mt-auto flex flex-col">
            {mode === 'offline' && offline ? (
              <Button variant="primaer" size={56} className="w-full" onPress={offline.onRetry}>
                {offline.retryLabel}
              </Button>
            ) : (
              <Button variant="primaer" size={56} className="w-full" data-opens="find"
                {...(onFindMusic ? {onPress: onFindMusic} : {})}>Find musik</Button>
            )}
          </div>
        </>
      ) : null}

      {mode === 'other' ? (
        <>
          <div className="mt-5 size-[196px] self-center overflow-hidden rounded-pv-s bg-pv-placeholder opacity-55
            grayscale-[.6]" role="img" aria-label="Deres cover">
            {cover ? <img className="size-full object-cover" src={cover} alt="" decoding="async" /> : null}
          </div>
          <Track title={title} artist={artist} />
          <div className="mt-[22px] flex h-11 items-center gap-2 self-start rounded-pv-pill bg-pv-placeholder px-4
            text-[15px] font-semibold text-pv-ink-2">
            <Glyph name="lock" size={18} />
            Bruges af en anden
          </div>
          {takeOver ? (
            <>
              <div className="mt-auto mb-3 grid h-16 grid-cols-[44px_1fr] items-center gap-3 rounded-2xl
                bg-pv-entry px-3 shadow-[inset_0_0_0_1px_rgba(23,23,26,.08)]">
                <span className="size-11 rounded-lg bg-pv-placeholder" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-bold">{takeOver.title}</span>
                  <span className="truncate text-[15px] text-pv-ink-3">{takeOver.line}</span>
                </span>
              </div>
              <Button variant="primaer" size={56} icon="speaker" className="mb-2 w-full" onPress={takeOver.onPress}>
                {takeOver.label}
              </Button>
            </>
          ) : (
            <div className="mt-auto mb-2 flex flex-col">
              <Button variant="primaer" size={56} icon="disc" className="w-full" data-opens="find"
                {...(onFindMusic ? {onPress: onFindMusic} : {})}>Vælg musik</Button>
            </div>
          )}
        </>
      ) : null}

      {mode === 'radio' && radio ? (
        <>
          {radio.logo ? (
            <img className="relative mt-5 size-[252px] self-center rounded-pv-widget" src={radio.logo}
              alt={radio.station}
              style={{boxShadow: `0 18px 36px -16px ${glow}`}} />
          ) : (
            <div className="mt-5 flex size-[252px] items-center justify-center self-center rounded-pv-widget
              bg-pv-radio text-pv-ink" aria-hidden="true"><Glyph name="radio" size={88} stroke={1.3} /></div>
          )}
          <Track title={radio.station} artist={radio.line} />
          <div className="relative mt-[22px] flex h-11 items-center justify-center gap-2.5">
            <i className={cx('block size-2.5 rounded-full', radio.live === 'stoppet' ? 'bg-pv-grey'
              : radio.live === 'forbinder' ? 'bg-pv-starting' : 'bg-pv-live',
            radio.live !== 'stoppet' && 'animate-pv-pending motion-reduce:animate-none')} />
            <span className="text-[15px] font-semibold tracking-[.12em] text-pv-ink-2 uppercase">
              {radio.live === 'forbinder' ? 'Forbinder' : radio.live === 'stoppet' ? 'Stoppet' : 'Direkte'}
            </span>
          </div>
          <div className="relative mt-3.5 flex justify-center">
            <AriaButton className={PLAY} aria-label={playing ? 'Stop' : 'Afspil'} isDisabled={disabled || !onToggle}
              data-busy={busy ? 'true' : undefined} {...(onToggle ? {onPress: onToggle} : {})}>
              <PlayGlyph name={playing ? 'stop' : 'play'} />
            </AriaButton>
          </div>
          <div className="mt-auto mb-2">{volume ? <Volume volume={volume} /> : null}</div>
        </>
      ) : null}

      {mode === 'mine' || mode === 'away' ? (
        <>
          {/* Paused, the cover steps back a little (canvas .95) on the smooth spring; playing, it is full size. */}
          <motion.div className="mt-5 shrink-0 self-center" initial={false} animate={{scale: playing ? 1 : 0.95}}
            transition={reduce ? TRANSITION.reduced : TRANSITION.smooth}>
          <AriaButton
              className={cx(pressable, 'relative block overflow-hidden rounded-pv-s',
                'bg-pv-placeholder',
                'text-pv-grey',
                mode === 'away' ? 'size-[196px]' : 'size-[252px]')}
              style={{boxShadow: `0 18px 36px -16px ${glow}`}}
              aria-label={title ? `Vis kø · ${title}${artist ? ` af ${artist}` : ''}` : 'Vis kø'}
              data-opens="music"
              {...(onCover ? {onPress: onCover} : {})}
            >
              <Cover src={cover} />
            </AriaButton>
          </motion.div>
          <Track title={title} artist={artist} {...(status ? {status} : {})} />
          <div className={cx('flex flex-col gap-2.5', mode === 'away' ? 'mt-3.5' : 'mt-[22px]')}
            style={{visibility: progress ? 'visible' : 'hidden'}}>
            {seek && progress ? (
              // The 44-px hit area around the 4-px rail, without moving the layout.
              <Slider className="-my-5" variant="player" follow="clock" label="Tidslinje" value={Math.round(seek.value)}
                min={0}
                max={Math.max(1, Math.round(seek.max))} isDisabled={seek.disabled}
                format={value => `${String(Math.floor(value / 60))}:${String(value % 60).padStart(2, '0')}`}
                onCommit={seek.onCommit} />
            ) : (
              <div className="relative h-1 rounded-xs bg-pv-ink/14" role="img"
                aria-label={progress ? `Spillet ${progress.position} af ${progress.duration}` : 'Ingen tid'}>
                <div className="absolute inset-y-0 left-0 rounded-xs bg-pv-ink"
                  style={{width: `${String((progress?.fraction ?? 0) * 100)}%`}} />
                <div className="absolute -top-[7px] size-[18px] rounded-full bg-pv-ink"
                  style={{left: `calc(${String((progress?.fraction ?? 0) * 100)}% - 9px)`}} />
              </div>
            )}
            <div className="flex justify-between text-[15px] font-medium text-pv-ink-3 tabular-nums">
              <span>{progress?.position ?? '0:00'}</span>
              <span>{progress?.duration ?? '0:00'}</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between px-3" role="group" aria-label="Afspilning">
            <AriaButton className={ROUND} aria-label="Forrige" isDisabled={disabled || !onPrevious}
              {...(onPrevious ? {onPress: onPrevious} : {})}>
              <Glyph name="prev" size={28} />
            </AriaButton>
            <AriaButton className={PLAY} aria-label={playing ? 'Pause' : 'Afspil'} isDisabled={disabled || !onToggle}
              data-busy={busy ? 'true' : undefined} {...(onToggle ? {onPress: onToggle} : {})}>
              <PlayGlyph name={playing ? 'pause' : 'play'} />
            </AriaButton>
            <AriaButton className={ROUND} aria-label="Næste" isDisabled={disabled || !onNext}
              {...(onNext ? {onPress: onNext} : {})}>
              <Glyph name="next" size={28} />
            </AriaButton>
          </div>
          <div className="mt-auto mb-2 flex flex-col gap-3">
            {volume ? <Volume volume={volume} /> : null}
            {mode === 'away' && away ? (
              <Button variant="primaer" size={56} icon="speaker" className="w-full" onPress={away.onMove}>
                {away.moveLabel}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {notice ? <div className="absolute inset-x-6 bottom-[84px] text-center text-[15px] text-pv-ink-2">{notice}</div>
        : null}
    </article>
  );
}
