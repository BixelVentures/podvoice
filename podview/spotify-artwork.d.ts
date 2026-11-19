// Types for the artwork painter used by src/: it owns an image's src, alt, artwork classes and data.
export interface RetainedArtwork {
  url: string;
  identity: string;
  contentIdentity?: string | undefined;
  label: string;
  diagnosticOwner?: unknown;
}
export function spotifyArtwork(value: unknown, uri?: unknown): string | null;
export function generatedMoodArtwork(value: unknown, themeId: unknown): string | null;
export function renderRetainedArtwork(image: Element, options: RetainedArtwork): void;
export function renderSpotifyArtwork(
  image: Element,
  item: {uri?: unknown; name?: unknown; artwork?: unknown},
  contentIdentity?: unknown,
  quiet?: boolean,
  diagnosticOwner?: unknown,
): void;
export function cancelArtwork(image: Element): void;
