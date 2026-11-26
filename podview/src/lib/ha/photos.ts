// Ro's photos from the household's shared iCloud album (the PodVoice integration's photos.py). The integration
// polls the album every 15 minutes, caches each photo once on Home Assistant and answers `podvoice.photos` with the
// album's status and the photos, newest in the album first, each with a URL to its authenticated view signed for
// this user for 24 hours. The panel never sees an Apple URL. Read when Ro opens and every 15 minutes while it is up;
// a failed read keeps the last list (offline: the last photo stays, with no error). »Hent nu« (Skærm og enhed) is
// `podvoice.photos_refresh`: the integration reads the album at once and answers the same way.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {useMemo} from 'react';
import {z} from 'zod';
import {haKeys, serviceResponse} from './transport';
import type {HaTransport} from './transport';
import {transport as appTransport} from './transport';

const photoSchema = z.object({
  id: z.string().min(1).max(80),
  url: z.string().min(1).max(4096),
  width: z.number(),
  height: z.number(),
  created: z.string().nullable(),
  added: z.string().nullable(),
  portrait: z.boolean(),
  version: z.string().max(32).default(''),
});
const albumSchema = z.looseObject({
  ok: z.literal(true),
  configured: z.boolean(),
  album: z.string().max(200),
  count: z.number(),
  last_sync: z.string().nullable(),
  last_error: z.string().max(64).nullable(),
  photos: z.array(photoSchema).max(1000),
});
export type AlbumPhoto = z.infer<typeof photoSchema>;
export type PhotoAlbum = z.infer<typeof albumSchema>;

export const photosKey = [...haKeys.read, 'photos'] as const;
export const PHOTOS_REFRESH_MS = 15 * 60_000;
// A signed URL holds 24 h; one is used again for 12 h, so the photo on screen keeps its URL (and its cached copy).
export const URL_REUSE_MS = 12 * 3600_000;

async function read(service: 'photos' | 'photos_refresh', source: HaTransport): Promise<PhotoAlbum> {
  const result = await serviceResponse({domain: 'podvoice', service, data: {}, returnResponse: true}, albumSchema,
    source);
  if (!result.ok) throw new Error(result.reason || result.outcome);
  return result.value;
}

/** The album: read on mount (Ro opens, the sheet opens) and every 15 min while `enabled`. */
export function usePhotoAlbum(enabled: boolean) {
  return useQuery({
    queryKey: photosKey,
    enabled,
    staleTime: 0,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? PHOTOS_REFRESH_MS : false,
    queryFn: () => read('photos', appTransport),
  });
}

/** »Hent nu«: the integration reads the album at once; its answer is the new list. */
export async function refreshPhotos(client: QueryClient, source: HaTransport = appTransport): Promise<boolean> {
  try {
    client.setQueryData(photosKey, await read('photos_refresh', source));
    return true;
  } catch {
    return false;
  }
}

export interface ShownPhoto {
  id: string;
  src: string;
  alt: string;
  at: number;
  portrait: boolean;
}

/**
 * The album as Ro's carousel takes it (RestPhoto), newest first. A photo keeps the URL it was first given for 12 h
 * (a fresh signature on every read would be a new image to the browser); an edited photo (a new version) gets the
 * new one at once.
 */
// The URL each photo (and version) was first given, and when (one wall: one cache for the page).
const signed = new Map<string, {src: string; at: number}>();

export function useAlbumPhotos(album: PhotoAlbum | undefined, now: () => number = Date.now): ShownPhoto[] | null {
  return useMemo(() => {
    if (!album?.configured || album.photos.length === 0) return null;
    const time = now();
    const kept = new Map<string, {src: string; at: number}>();
    const shown = album.photos.map(photo => {
      const key = `${photo.id}:${photo.version}`;
      const old = signed.get(key);
      const entry = old && time - old.at < URL_REUSE_MS ? old : {src: photo.url, at: time};
      kept.set(key, entry);
      const added = Date.parse(photo.added ?? photo.created ?? '');
      return {id: photo.id, src: entry.src, alt: album.album ? `Billede fra ${album.album}` : 'Billede fra albummet',
        at: Number.isFinite(added) ? added : 0, portrait: photo.portrait};
    });
    signed.clear();
    for (const [key, entry] of kept) signed.set(key, entry);
    return shown;
    // `now` is a clock, not data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album]);
}

const zone = 'Europe/Copenhagen';
/** »13 billeder · opdateret 14.30« (Skærm og enhed's Fotoalbum row). */
export function albumLine(album: PhotoAlbum): string {
  const count = `${String(album.count)} ${album.count === 1 ? 'billede' : 'billeder'}`;
  const synced = album.last_sync ? new Date(album.last_sync) : null;
  if (!synced || Number.isNaN(synced.getTime())) return count;
  const time = synced.toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit', timeZone: zone});
  return `${count} · opdateret ${time}`;
}

/** What a failed read means to the household (the integration's error code). */
export function albumError(code: string | null): string | null {
  if (!code) return null;
  if (code === 'offline') return 'Ingen forbindelse til iCloud lige nu. Billederne, Ro har, bliver vist.';
  if (code === 'not_public') return 'Albummets offentlige link er slået fra i Fotos. Slå »Offentligt websted« til.';
  if (code === 'not_found') return 'Albummet findes ikke længere. Sæt et nyt link i PodVoice-integrationen.';
  return 'iCloud svarede ikke. Der prøves igen om lidt.';
}

export function useRefreshPhotos() {
  const client = useQueryClient();
  return () => refreshPhotos(client);
}
