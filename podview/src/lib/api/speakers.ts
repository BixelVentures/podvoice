// PodConnect's current speakers for this room (podview.speaker-catalogue.v1), read at the wire with zod, and the one
// table that decides whether a speaker row can be chosen and which reason it shows. A catalogue is display and
// comparison evidence for 30 s; it never proves output and grants no action by itself.
import {z} from 'zod';
import {mediaRoomBinding} from './media';
import type {MediaSnapshot} from './media';

export const CATALOGUE_VALID_MS = 30000;
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(1024);
const blockReason = z.enum(['no_rule', 'duplicate_rule', 'unavailable', 'no_homepod_id']).nullable();

const rowSchema = z.strictObject({
  speakerId: hex,
  accountId: z.string(),
  kind: z.literal('configured_alias'),
  nativeRoomId: text,
  homepodId: z.string().regex(/^[1-9][0-9]{0,19}$/).nullable(),
  name: text,
  availability: z.enum(['available', 'unavailable', 'unknown']),
  default: z.boolean(),
  nativeSelected: z.boolean(),
  outputSelected: z.boolean().nullable(),
  selectable: z.boolean(),
  startSelectable: z.boolean().optional(),
  startBlockedReason: blockReason.optional(),
  moveBlockedReason: blockReason.optional(),
});
export type SpeakerRow = z.infer<typeof rowSchema>;

const catalogueSchema = z.strictObject({
  ok: z.literal(true),
  schema: z.literal('podview.speaker-catalogue.v1'),
  bootId: z.unknown(),
  roomId: z.unknown(),
  accountId: z.unknown(),
  status: z.literal('observed'),
  catalogueId: hex,
  retrievedAt: z.number().refine(Number.isFinite),
  source: z.literal('podconnect.get_targets'),
  speakers: z.array(rowSchema).min(1).max(64),
  moveAvailable: z.boolean(),
  physicalResultVerified: z.literal(false),
});
export type SpeakerCatalogueValue = z.infer<typeof catalogueSchema>;

export interface CatalogueContext {
  bootId: unknown;
  roomId: unknown;
  accountId: unknown;
}

const PREFERRED = ['køkkenalrum', 'svend', 'frida'];
const rank = (row: SpeakerRow) => {
  const name = row.name.trim().toLocaleLowerCase('da').replace(/\s+homepod$/, '').replace(/['’]s$/, '');
  const index = PREFERRED.indexOf(name);
  return index < 0 ? PREFERRED.length : index;
};

// The catalogue's rows in the order the picker shows them, or null when it is not this room's current catalogue.
export function speakerCatalogue(value: unknown, context: CatalogueContext, now = Date.now()): SpeakerRow[] | null {
  const parsed = catalogueSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  if (v.bootId !== context.bootId || v.roomId !== context.roomId || v.accountId !== context.accountId ||
    v.retrievedAt * 1000 > now + 5000 || now - v.retrievedAt * 1000 > CATALOGUE_VALID_MS) return null;
  const ids = new Set<string>(), rooms = new Set<string>();
  for (const row of v.speakers) {
    if (ids.has(row.speakerId) || rooms.has(row.nativeRoomId) || row.accountId !== context.accountId) return null;
    ids.add(row.speakerId);
    rooms.add(row.nativeRoomId);
  }
  return [...v.speakers].sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name, 'da') || a.speakerId.localeCompare(b.speakerId));
}

// The parsed value when it is this room's catalogue (fresh or not), for its retrieval time and move rule.
export function catalogueValue(value: unknown): SpeakerCatalogueValue | null {
  const parsed = catalogueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// The name of the speaker the room is configured to play on.
export function configuredSpeakerLabel(value: unknown, snapshot: MediaSnapshot | null | undefined, account: unknown,
  now = Date.now()): string {
  const binding = mediaRoomBinding(snapshot, account);
  const rows = binding && speakerCatalogue(value, {bootId: snapshot?.bootId, roomId: snapshot?.roomId,
    accountId: account}, now);
  if (!binding || !rows) return '';
  const matches = rows.filter(row => row.accountId === binding.accountId &&
    row.nativeRoomId === binding.nativeRoomId && row.homepodId === binding.nativeHomepodId);
  return matches.length === 1 ? (matches[0]?.name ?? '') : '';
}

const SERVER_BLOCK_LABELS: Record<string, string> = {
  no_rule: 'Ingen PodConnect-regel tillader denne højttaler i rummet',
  duplicate_rule: 'Flere PodConnect-regler matcher · ret opsætningen',
  unavailable: 'Ikke tilgængelig',
  no_homepod_id: 'Afspilningsmål er ikke bekræftet',
};

export interface RowContext {
  busy?: boolean;
  music?: boolean;
  warmup?: boolean;
  selection?: unknown;
  moveAvailable?: unknown;
  fenced?: string | null;
  actualOutput?: boolean;
}

export type RowReason = 'ok' | 'busy-music' | 'unavailable' | 'unknown' | 'no-homepod' | 'no-start-rule' | 'no-move' |
  'current';

export interface RowState {
  reason: RowReason;
  disabled: boolean;
  label: string;
}

const blocked = (reason: string | null | undefined) =>
  SERVER_BLOCK_LABELS[reason ?? ''] ?? 'Kan ikke vælges til afspilning';

function rowLabel(reason: RowReason, ctx: RowContext, row: SpeakerRow | null | undefined): string {
  switch (reason) {
    case 'ok':
      return ctx.music ? (ctx.fenced === 'accepted' ? 'Afventer bekræftelse af afspilningen'
        : 'Kan vælges til den aktuelle afspilning') : '';
    case 'busy-music':
      return 'Musikhandlingen behandles';
    case 'unavailable':
      return 'Ikke tilgængelig';
    case 'unknown':
      return 'Status ukendt';
    case 'no-homepod':
      return 'Afspilningsmål er ikke bekræftet';
    case 'no-start-rule':
      return blocked(row?.startBlockedReason);
    case 'no-move':
      return blocked(row?.moveBlockedReason);
    case 'current':
      return 'Bruges til den aktuelle afspilning';
  }
}

export function speakerRowState(row: SpeakerRow | null | undefined, ctx: RowContext = {}): RowState {
  const moves = ctx.moveAvailable === true && row?.selectable === true;
  const starts = ctx.selection === true && row?.startSelectable === true;
  const reason: RowReason = row?.availability === 'unknown' ? 'unknown'
    : row?.availability !== 'available' ? 'unavailable'
      : ctx.busy ? 'busy-music'
        : ctx.music && ctx.actualOutput ? 'current'
          : !row.homepodId ? 'no-homepod'
            // Warm-up: the player shows the room's last report until its own read lands, so music may or may not
            // play. Either rule admits the speaker; the tap waits for that read (a last-known state never locks).
            : ctx.warmup ? (moves || starts ? 'ok' : 'no-move')
              : ctx.music ? (moves ? 'ok' : 'no-move')
                : starts ? 'ok' : 'no-start-rule';
  return {reason, disabled: !['ok', 'current'].includes(reason), label: rowLabel(reason, ctx, row)};
}

// Only a music command in flight holds the speaker list; robot, light, search and dialogs do not.
export function musicBusy(controls: {pending?: unknown; activeOperation?: {domain?: unknown} | null} | null |
  undefined): boolean {
  return !!(controls?.pending && controls.activeOperation?.domain === 'music');
}
