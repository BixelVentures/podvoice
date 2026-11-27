// Find musik B's reads beyond the library shelves (custom_components/podvoice/find_music.py): Spotify search through
// PodConnect (podvoice.music_search, at most 10 rows), the Stemning and Humør themes (podvoice.music_moods, the
// add-on's own tables) and »AI-valgt« (podvoice.music_picks: the add-on's search ideas and reasons, real playlists
// from Spotify search). Everything is read only on request and kept in the query cache: Spotify's quota is shared, so
// a theme, a query or the AI picks are read at most once per ten minutes (the integration caches as well). The page's
// own choices (the submitted query, the chosen theme) are UI state in one Zustand store; a new choice replaces the
// old one at once (last tap wins) and nothing is ever read again by itself.
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {create} from 'zustand';
import {haKeys, serviceResponse} from './transport';

const IMAGE = new RegExp(String.raw`^https://(i\.scdn\.co|image-cdn-fa\.spotifycdn\.com|image-cdn-ak\.spotifycdn\.com)`
  + String.raw`/image/[\w-]{1,128}$`);
const URI = /^spotify:(track|playlist):[A-Za-z0-9]{22}$/;

export const itemSchema = z.object({
  kind: z.enum(['track', 'playlist']),
  uri: z.string().regex(URI),
  name: z.string().min(1).max(256),
  byline: z.string().max(512).nullable(),
  artwork: z.string().regex(IMAGE).nullable(),
});
export type FindItem = z.infer<typeof itemSchema>;

// Closed failure codes from the integration; anything else is »unreadable«.
export const FIND_ERRORS = ['addon_unavailable', 'addon_refused', 'ai_unavailable', 'ai_failed', 'rate_limited',
  'podconnect_unavailable', 'account_unavailable', 'unreadable'] as const;
export type FindError = (typeof FIND_ERRORS)[number];
const errorSchema = z.enum(FIND_ERRORS).catch('unreadable');

const searchSchema = z.union([
  z.looseObject({ok: z.literal(true), kind: z.enum(['track', 'playlist']), query: z.string().max(160),
    items: z.array(itemSchema).max(10)}),
  z.looseObject({ok: z.literal(false), error: errorSchema}),
]);
const moodsSchema = z.looseObject({
  ok: z.literal(true),
  groups: z.array(z.object({
    id: z.enum(['mood', 'feeling']),
    label: z.string().min(1).max(40),
    themes: z.array(z.object({id: z.string().regex(/^[a-z_]{1,40}$/), title: z.string().min(1).max(60)})).max(12),
  })).max(2),
});
export type MoodGroup = z.infer<typeof moodsSchema>['groups'][number];
const shelfSchema = z.object({
  id: z.enum(['ai_moment', 'ai_daypart', 'ai_artist', 'ai_season']),
  title: z.string().min(1).max(48),
  why: z.string().min(1).max(200),
  items: z.array(itemSchema).min(1).max(12),
});
export type AiShelf = z.infer<typeof shelfSchema>;
const picksSchema = z.union([
  z.looseObject({ok: z.literal(true), shelves: z.array(shelfSchema).max(4)}),
  z.looseObject({ok: z.literal(false), error: errorSchema}),
]);

// What the page says when a read has no rows to show: what happened and what the user can do.
export const ERROR_TEXT: Record<FindError, string> = {
  addon_unavailable:
    'PodVoice-add-on’et svarer ikke lige nu, så der er ingen AI-valgte forslag. Resten af siden virker.',
  addon_refused: 'PodVoice-add-on’et afviste at lave AI-valgte forslag. Resten af siden virker.',
  ai_unavailable: 'AI-valgte forslag er ikke slået til i PodVoice-add-on’et. Resten af siden virker.',
  ai_failed: 'AI-valgte forslag kunne ikke laves lige nu. Prøv igen om en halv time.',
  rate_limited: 'Spotify beder os vente lidt. Prøv igen om et par minutter.',
  podconnect_unavailable: 'PodConnect svarer ikke. Prøv igen om lidt.',
  account_unavailable: 'PodConnect har ikke én Spotify-konto at søge med.',
  unreadable: 'Svaret kunne ikke læses. Prøv igen.',
};

export class FindFailure extends Error {
  readonly code: FindError;
  constructor(code: FindError) {
    super(code);
    this.code = code;
  }
}

export const STALE_MS = 10 * 60_000;
export const findKey = (...parts: string[]) => [...haKeys.read, 'find', ...parts] as const;

async function read<T>(service: string, data: Record<string, unknown>, schema: z.ZodType<T>) {
  const result = await serviceResponse({domain: 'podvoice', service, data, returnResponse: true}, schema);
  // A refused or lost call is shown as such; it is never sent again by itself.
  if (!result.ok) throw new FindFailure(result.reason === 'unreadable' ? 'unreadable' : 'podconnect_unavailable');
  return result.value;
}

// Kept a while after Find musik closes (reopening it draws at once), then let go: every search is its own entry.
export const FIND_GC_MS = 30 * 60_000;
const options = {staleTime: STALE_MS, gcTime: FIND_GC_MS, retry: false, refetchOnWindowFocus: false} as const;

export function useMoods(enabled: boolean) {
  return useQuery({
    ...options,
    staleTime: Infinity,
    queryKey: findKey('moods'),
    enabled,
    queryFn: async () => (await read('music_moods', {}, moodsSchema)).groups,
  });
}

async function search(data: Record<string, string>) {
  const value = await read('music_search', data, searchSchema);
  if (!value.ok) throw new FindFailure(value.error);
  return value.items;
}

export function useSearch(query: string | null) {
  return useQuery({
    ...options,
    queryKey: findKey('search', 'track', (query ?? '').toLocaleLowerCase('da')),
    enabled: !!query,
    // The rows shown stay while a new search runs: no empty intermediate state.
    placeholderData: keepPreviousData,
    queryFn: () => search({query: query ?? '', kind: 'track'}),
  });
}

export function useTheme(theme: string | null) {
  return useQuery({
    ...options,
    queryKey: findKey('theme', theme ?? ''),
    enabled: !!theme,
    placeholderData: keepPreviousData,
    queryFn: () => search({theme: theme ?? ''}),
  });
}

export function usePicks(enabled: boolean, weatherEntity: string | null) {
  return useQuery({
    ...options,
    queryKey: findKey('picks', weatherEntity ?? ''),
    enabled,
    queryFn: async () => {
      const value = await read('music_picks', weatherEntity ? {weather_entity: weatherEntity} : {}, picksSchema);
      if (!value.ok) throw new FindFailure(value.error);
      return value.shelves;
    },
  });
}

// ---- PodConnect's library shelves ------------------------------------------------------------------------------

const shelfArtwork = z.union([z.string(), z.looseObject({url: z.string()}), z.null()]).optional();
const tracksSchema = z.looseObject({
  ok: z.literal(true),
  tracks: z
    .array(
      z.looseObject({
        name: z.string().max(256).nullable(),
        artist: z.string().max(512).nullable().optional(),
        uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/),
        artwork: shelfArtwork,
      }),
    )
    .max(50),
});
type Track = z.infer<typeof tracksSchema>['tracks'][number];

// PodConnect's library shelves, titled as Hylder: the top tracks (»Det, I spiller mest«) and what was played last
// (»Fortsæt med at lytte«).
export const SHELVES = [
  {kind: 'top', label: 'For dig', service: 'top_tracks', detail: 'Dine topsange', why: 'Det, I spiller mest'},
  {kind: 'recent', label: 'Fortsæt med at lytte', service: 'recently_played', detail: '', why: ''},
] as const;
export type LibraryShelfKind = (typeof SHELVES)[number];

const SHELF_STALE_MS = 10 * 60_000;
const coverOf = (track: Track) => {
  const url = typeof track.artwork === 'string' ? track.artwork : track.artwork?.url;
  return url?.startsWith('https://') ? url : null;
};

export const shelfKey = (kind: string) => [...haKeys.read, 'shelf', kind] as const;

// One read per shelf, shared by everyone who shows it (Find musik's shelves and the empty player's »Hør igen«): the
// same key and options, so the query cache holds one answer and nothing is read twice.
export function useLibraryShelf(shelf: LibraryShelfKind, enabled = true) {
  return useQuery({
    queryKey: shelfKey(shelf.kind),
    staleTime: SHELF_STALE_MS,
    gcTime: Math.max(SHELF_STALE_MS, FIND_GC_MS),
    enabled,
    queryFn: async (): Promise<FindItem[]> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'music_shelf', data: {shelf: shelf.service}, returnResponse: true},
        tracksSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      // The same track twice on a shelf is one card.
      return result.value.tracks
        .filter((track, index, all) => all.findIndex(row => row.uri === track.uri) === index)
        .map(track => ({kind: 'track', uri: track.uri, name: track.name ?? '', byline: track.artist ?? null,
          artwork: coverOf(track)}));
    },
  });
}

export const failureText = (error: unknown) =>
  ERROR_TEXT[error instanceof FindFailure ? error.code : 'unreadable'];

// ---- The page's own choices ------------------------------------------------------------------------------------

interface FindChoices {
  // The last submitted search (trimmed), or none.
  query: string | null;
  // The chosen Stemning/Humør theme, or none.
  theme: string | null;
  submit: (query: string) => void;
  clear: () => void;
  choose: (theme: string) => void;
}

export const useFindChoices = create<FindChoices>(set => ({
  query: null,
  theme: null,
  submit: query => {
    const text = query.split(/\s+/).filter(Boolean).join(' ').slice(0, 160);
    set({query: text || null});
  },
  clear: () => {
    set({query: null});
  },
  // Tapping the chosen theme again closes it.
  choose: theme => {
    set(state => ({theme: state.theme === theme ? null : theme}));
  },
}));

export function resetFindChoices() {
  useFindChoices.setState({query: null, theme: null});
}
