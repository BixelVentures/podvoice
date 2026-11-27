// Find musik's reads beyond the library shelves (custom_components/podvoice/find_music.py): Spotify search through
// PodConnect (podvoice.music_search, at most 10 rows), an activity's playlists (»Hvad skal musikken til?«: the same
// search with one fixed playlist query per activity), the wall's last activities (podvoice.music_activities) and
// »AI-valgt« (podvoice.music_picks: the add-on's search ideas and reasons, real playlists from Spotify search).
// Everything is read only on request and kept in the query cache: Spotify's quota is shared, so a query or the AI
// picks are read at most once per ten minutes and an activity once per visit of the panel (the integration caches as
// well). The page's own choices (the submitted query, the chosen activity) are UI state in one Zustand store; a new
// choice replaces the old one at once (last tap wins) and nothing is ever read again by itself.
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import type {ActivityId} from '../format/activities';
import {ACTIVITY_IDS} from '../format/activities';
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
const historySchema = z.looseObject({
  ok: z.literal(true),
  history: z.array(z.object({activity: z.enum(ACTIVITY_IDS as [ActivityId, ...ActivityId[]]), at: z.string().max(40)}))
    .max(4),
});
export type ActivityUse = z.infer<typeof historySchema>['history'][number];
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

// An activity's playlists: read once per visit of the panel (Spotify's shared quota); the page shows three.
export function useActivity(activity: ActivityId | null) {
  return useQuery({
    ...options,
    staleTime: Infinity,
    queryKey: findKey('activity', activity ?? ''),
    enabled: !!activity,
    queryFn: () => search({activity: activity ?? ''}),
  });
}

export const historyKey = findKey('activities');

// »Jeres seneste stemninger«: the wall's last four activities, newest first (no Spotify call).
export function useActivityHistory() {
  return useQuery({
    ...options,
    staleTime: Infinity,
    queryKey: historyKey,
    queryFn: async () => (await read('music_activities', {}, historySchema)).history,
  });
}

// A chosen activity is recorded for the wall; the answer is the new history. A lost record changes nothing shown.
export async function recordActivity(activity: ActivityId) {
  const result = await serviceResponse({domain: 'podvoice', service: 'music_activities', data: {used: activity},
    returnResponse: true}, historySchema);
  return result.ok ? result.value.history : null;
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

export const failureText = (error: unknown) =>
  ERROR_TEXT[error instanceof FindFailure ? error.code : 'unreadable'];

// ---- The page's own choices ------------------------------------------------------------------------------------

interface FindChoices {
  // The last submitted search (trimmed), or none.
  query: string | null;
  // The chosen activity, or none.
  activity: ActivityId | null;
  submit: (query: string) => void;
  clear: () => void;
  choose: (activity: ActivityId | null) => void;
}

export const useFindChoices = create<FindChoices>(set => ({
  query: null,
  activity: null,
  submit: query => {
    const text = query.split(/\s+/).filter(Boolean).join(' ').slice(0, 160);
    set({query: text || null});
  },
  clear: () => {
    set({query: null});
  },
  // A new activity replaces the chosen one at once (last tap wins); none closes the results.
  choose: activity => {
    set({activity});
  },
}));

export function resetFindChoices() {
  useFindChoices.setState({query: null, activity: null});
}
