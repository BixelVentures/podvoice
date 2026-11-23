// Which pictures PodView may show for a song, a playlist or a mood (no DOM here). Provider covers stay bound to
// their source; thematic alternatives come from closed owner paths. Neither kind grants playback actions.
import {z} from 'zod';

export interface SpotifyArtwork {
  kind: 'album_cover' | 'playlist_cover';
  provider: 'spotify';
  url: string;
}

const PLAYLIST_URI = /^spotify:playlist:[A-Za-z0-9]{22}$/;
const IMAGE_PATH = /^\/image\/[A-Za-z0-9_-]{1,128}$/;
const ALBUM_HOSTS = ['i.scdn.co'];
const PLAYLIST_HOSTS = ['i.scdn.co', 'image-cdn-fa.spotifycdn.com', 'image-cdn-ak.spotifycdn.com'];
const THEMES = ['morning_acoustic', 'evening_jazz', 'cooking', 'italian', 'indie', 'calm'];

const artworkSchema = z.strictObject({
  kind: z.enum(['album_cover', 'playlist_cover']),
  provider: z.literal('spotify'),
  url: z.string().max(512),
});

export function isPlaylistUri(uri: unknown): boolean {
  return typeof uri === 'string' && PLAYLIST_URI.test(uri);
}

// A provider cover: an exact https image path on Spotify's image hosts, of the kind the item allows.
export function spotifyArtwork(value: unknown, uri?: unknown): SpotifyArtwork | null {
  const parsed = artworkSchema.safeParse(value);
  if (!parsed.success) return null;
  const {kind, url: raw} = parsed.data, playlist = isPlaylistUri(uri);
  if (kind === 'playlist_cover' ? !playlist : playlist) return null;
  try {
    const url = new URL(raw);
    const hosts = kind === 'playlist_cover' ? PLAYLIST_HOSTS : ALBUM_HOSTS;
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password ||
      url.search || url.hash || !IMAGE_PATH.test(url.pathname) || raw !== `https://${url.hostname}${url.pathname}`)
      return null;
  } catch {
    return null;
  }
  return {kind, provider: 'spotify', url: raw};
}

// Immutable, owner-published thematic files; never an arbitrary image URL.
export function generatedMoodArtwork(value: unknown, themeId: unknown): string | null {
  if (typeof value !== 'string' || typeof themeId !== 'string' || !THEMES.includes(themeId)) return null;
  const prefix = `theme-art/${themeId}/`;
  return value.startsWith(prefix) && /^[a-f0-9]{64}\.webp$/.test(value.slice(prefix.length)) ? value : null;
}

export function spotifyItemUrl(uri: unknown): string | null {
  const match = /^spotify:(track|episode):([A-Za-z0-9]{22})$/.exec(typeof uri === 'string' ? uri : '');
  return match ? `https://open.spotify.com/${match[1] ?? ''}/${match[2] ?? ''}` : null;
}

export function spotifyTrackUrl(uri: unknown): string | null {
  return typeof uri === 'string' && uri.startsWith('spotify:track:') ? spotifyItemUrl(uri) : null;
}

const FIXTURE_HOSTS = ['image-cdn-fa.spotifycdn.com', 'image-cdn-ak.spotifycdn.com'];
// The fixture adapter admits only bundled images or its explicitly verified artwork hosts.
export function fixtureArtwork(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^assets\/[A-Za-z0-9_/-]+\.(png|webp|jpg|jpeg|svg)$/.test(value))
    return value.replace(/^assets\/(morning-acoustic|kitchen|italian|lake|indie)\.png$/, 'assets/$1.webp');
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && FIXTURE_HOSTS.includes(u.hostname) && !u.port && !u.username && !u.password &&
      !u.search && !u.hash && /^\/image\/[A-Za-z0-9]+$/.test(u.pathname) ? u.href : null;
  } catch {
    return null;
  }
}
