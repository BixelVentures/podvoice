// Types for the player view models used by src/.
export const PLAYER_SPEAKER_IDLE_MS: number;
export const OTHER_ACCOUNT: string;
export function txt(value: unknown): string;
export interface SourceFocus {
  readonly scope: string | null;
  readonly kind: 'auto' | 'music' | 'radio';
  readonly target: Readonly<Record<string, unknown>> | null;
}
export function autoSourceFocus(scope: string | null): SourceFocus;
