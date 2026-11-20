// Where the PodVoice API lives. PodView is served under Home Assistant ingress at an unknown prefix
// (…/api/hassio_ingress/<token>/view/index.html); the API is the sibling `…/view/api/`, same origin.

const ENDPOINTS = [
  'snapshot',
  'events',
  'music',
  'radio',
  'actions',
  'pair',
  'home',
  'answers',
  'controller/renew',
  'controller/request',
  'controller/claim',
] as const;
export type Endpoint = (typeof ENDPOINTS)[number];

// The API base for a page URL. Only an http(s) page under /view/ has one.
export function apiBase(pageUrl: string): URL {
  const page = new URL(pageUrl);
  if (!['https:', 'http:'].includes(page.protocol) || !page.pathname.includes('/view/'))
    throw new Error('PodVoice ingress /view/ is required');
  const prefix = page.pathname.slice(0, page.pathname.lastIndexOf('/view/') + 6);
  return new URL(`${prefix}api/`, page.origin);
}

// One endpoint URL, scoped to the room when the screen has one.
export function endpointUrl(
  base: URL,
  path: string,
  room: string | undefined,
  params: Record<string, string | undefined> = {},
): URL {
  if (!(ENDPOINTS as readonly string[]).includes(path)) throw new Error('unsupported_endpoint');
  const url = new URL(path, base);
  if (room) url.searchParams.set('room', room);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url;
}

// Explicit actions carry this header; the server refuses cross-site posts without it.
export const ACTION_HEADERS = {'Content-Type': 'application/json', 'X-PodView-Request': '1'} as const;
