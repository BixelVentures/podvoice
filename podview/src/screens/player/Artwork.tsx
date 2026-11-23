// A cover in the player and the queue. Which picture may show is decided here from the item (lib/api/artwork.ts):
// an illustration while a chosen playlist starts, a station logo, the room player's own cover, a bundled fixture,
// or Spotify's cover. The shown picture stays in place while its replacement is fetched and decoded; a picture that
// fails is remembered for that song and the note symbol shows instead (one diagnostic row, never a broken image).
import {motion} from 'motion/react';
import type {ImgHTMLAttributes} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {fixtureArtwork, generatedMoodArtwork, isPlaylistUri, spotifyArtwork, spotifyItemUrl}
  from '../../lib/api/artwork';
import {useReducedMotion} from '../../lib/motion/reduced';
import {txt} from './player-model';
import {usePlayer} from './store';
import type {PlayerModel, QueueItem} from './types';

export const FALLBACK_ART = 'assets/icons/music-note-beamed.svg';
const RADIO_LOGO = /^assets\/radio-(p3|p1|p4-ostjylland|p6-beat|p8-jazz)\.svg$/;

export interface ArtSource {
  url: string | null;
  identity: string;
  contentIdentity: string;
  label: string;
  provider: boolean;
}

export function artSource(item: PlayerModel | QueueItem, base?: string): ArtSource {
  const title = txt(item.title), uri = item.uri ?? '';
  if (item.loading && isPlaylistUri(uri) && !spotifyArtwork(item.artwork, uri)) {
    const illustration = generatedMoodArtwork(item.themeArt, item.themeId) ||
      (item.themeArt?.startsWith('assets/') ? fixtureArtwork(item.themeArt) : null);
    if (illustration) return {url: illustration, identity: illustration, contentIdentity: uri,
      label: `Illustration til ${title}`, provider: false};
  }
  if (item.sourceKind === 'radio' && RADIO_LOGO.test(item.fixtureArt ?? '')) {
    const art = item.fixtureArt ?? '';
    return {url: art, identity: `radio|${art}`, contentIdentity: art, label: `Stationslogo til ${title}`,
      provider: false};
  }
  if (typeof item.artworkUrl === 'string' && item.artworkUrl) {
    const url = base ? new URL(item.artworkUrl, base).href : item.artworkUrl;
    return {url, identity: `room|${item.artworkUrl}`, contentIdentity: uri || item.artworkUrl,
      label: `Albumomslag til ${title}`, provider: false};
  }
  if (item.fixtureArt && fixtureArtwork(item.fixtureArt))
    return {url: item.fixtureArt, identity: `fixture|${item.fixtureArt}`,
      contentIdentity: item.trackId || item.id || item.fixtureArt, label: `Albumomslag til ${title}`, provider: false};
  const playlist = isPlaylistUri(uri);
  const art = spotifyItemUrl(uri) || playlist ? spotifyArtwork(item.artwork, uri) : null;
  return {url: art?.url ?? null, identity: art ? `${uri}|${art.url}` : '', contentIdentity: uri,
    label: playlist ? `Playlisteomslag til ${title || 'afspilningslisten'}` : `Albumomslag til ${title || 'sangen'}`,
    provider: true};
}

interface Shown {
  url: string;
  identity: string;
  content: string;
  label: string;
  provider: boolean;
}

interface ArtState {
  // The song this state belongs to: another song starts clean (its old picture is not shown while it loads).
  content: string;
  shown: Shown | null;
  failed: readonly string[];
}

// The picture on screen for one source: the last decoded one until the next has decoded, the note symbol when there
// is none or it failed. Failures are remembered per song (a later read of the same song does not retry them).
function useRetainedArt(source: ArtSource): {shown: Shown | null; fail: () => void} {
  const {url, identity, label, provider, contentIdentity} = source;
  const [state, setState] = useState<ArtState>({content: contentIdentity, shown: null, failed: []});
  const transport = usePlayer(store => store.host.liveTransport);
  if (state.content !== contentIdentity) setState({content: contentIdentity, shown: null, failed: []});
  const failed = state.failed.includes(identity);
  const wanted = !!url && !!identity && !failed;
  const record = useCallback((code: string) => {
    try {
      transport?.recordDiagnostic?.('artwork', {code});
    } catch {
      /* Diagnostics cannot replace or interrupt the fallback. */
    }
  }, [transport]);
  const loaded = state.shown?.identity === identity;
  useEffect(() => {
    if (!wanted || loaded || !url) return;
    const next = {url, identity, content: contentIdentity, label, provider};
    const ImageClass = globalThis.Image as typeof Image | undefined;
    let cancelled = false;
    const fail = (code: string) => {
      if (cancelled) return;
      record(code);
      setState(current => current.content === contentIdentity
        ? {...current, failed: [...current.failed, identity]} : current);
    };
    const show = () => {
      if (!cancelled) setState(current => current.content === contentIdentity ? {...current, shown: next} : current);
    };
    // Without image decoding (a non-browser renderer) the picture is shown at once.
    if (!ImageClass) {
      queueMicrotask(show);
      return () => {
        cancelled = true;
      };
    }
    const probe = new ImageClass();
    probe.referrerPolicy = 'no-referrer';
    probe.decoding = 'async';
    probe.onerror = () => {
      fail('resource_error');
    };
    probe.onload = () => {
      void Promise.resolve().then(() => probe.decode()).then(show, () => {
        fail('decode_error');
      });
    };
    probe.src = url;
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
    // One probe per picture; its label follows without a new load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, identity, wanted, loaded, contentIdentity, record]);
  const shown = !wanted ? null : state.shown ? {...state.shown, ...(loaded ? {label} : {})} : null;
  return {
    shown,
    fail: () => {
      const broken = state.shown;
      if (!broken) return;
      record('resource_error');
      setState(current => ({...current, shown: null, failed: [...current.failed, broken.identity]}));
    },
  };
}

export interface ArtworkProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  item: PlayerModel | QueueItem;
  hidden?: boolean;
  onShown?: (image: HTMLImageElement | null) => void;
}

export function Artwork({item, className, onShown, ...rest}: ArtworkProps) {
  const base = usePlayer(state => state.host.liveTransport?.base);
  const source = artSource(item, base);
  const {shown, fail} = useRetainedArt(source);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLImageElement>(null);
  const classes = [className, shown ? (shown.provider ? 'spotify-artwork' : '') : 'live-art-fallback']
    .filter(Boolean).join(' ');
  useEffect(() => {
    onShown?.(shown ? ref.current : null);
  }, [shown, onShown]);
  return (
    <motion.img
      ref={ref}
      key={shown?.identity ?? 'fallback'}
      {...(rest as Record<string, unknown>)}
      className={classes}
      src={shown?.url ?? FALLBACK_ART}
      alt={shown ? shown.label : 'Omslag ikke tilgængeligt'}
      referrerPolicy="no-referrer"
      decoding="async"
      data-displayed-artwork={shown?.identity}
      initial={shown && !reduced ? {opacity: 0} : false}
      animate={{opacity: 1}}
      transition={{duration: 0.12, ease: [0.2, 0, 0, 1]}}
      onError={fail}
    />
  );
}
