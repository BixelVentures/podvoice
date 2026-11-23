// Types for the speaker catalogue and row rules used by src/.
export interface SpeakerRow {
  speakerId: string;
  accountId: string;
  kind: string;
  nativeRoomId: string;
  homepodId: string | null;
  name: string;
  availability: 'available' | 'unavailable' | 'unknown';
  default: boolean;
  nativeSelected: boolean;
  outputSelected: boolean | null;
  selectable: boolean;
  startSelectable?: boolean;
  startBlockedReason?: string | null;
  moveBlockedReason?: string | null;
}
export interface CatalogueContext {
  bootId: unknown;
  roomId: unknown;
  accountId: unknown;
}
export interface SpeakerCatalogueValue {
  retrievedAt: number;
  moveAvailable: boolean;
  speakers: SpeakerRow[];
}
export function speakerCatalogue(value: unknown, context: CatalogueContext, now?: number): SpeakerRow[] | null;
export function configuredSpeakerLabel(value: unknown, snapshot: unknown, account: unknown, now?: number): string;
export interface RowContext {
  busy?: boolean;
  music?: boolean;
  warmup?: boolean;
  selection?: unknown;
  moveAvailable?: unknown;
  fenced?: string | null;
  actualOutput?: boolean;
}
export function speakerRowState(
  row: SpeakerRow | undefined,
  ctx?: RowContext,
): {reason: string; disabled: boolean; label: string};
export function musicBusy(controls: unknown): boolean;
