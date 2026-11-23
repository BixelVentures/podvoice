// zod schemas for the PodVoice server payloads the React screens read. The server API is unchanged; these
// describe what PodView accepts. Fields a screen does not read pass through untouched (looseObject), so the
// legacy shell, which still reads the rest of the snapshot, sees exactly what the server sent.
import {z} from 'zod';

// Native timer revisions are decimal strings of at most 24 digits.
export const sourceRevision = z.string().regex(/^(0|[1-9][0-9]{0,23})$/);

// A native timer row. Only its identity is required here: a row with an id is the owner's timer, also when the
// screen cannot draw it (live-timers.ts admits what it shows). Proof of an action's effect looks at every row.
export const timerRowSchema = z.looseObject({
  id: z.string(),
  name: z.unknown().optional(),
  secondsLeft: z.unknown().optional(),
  status: z.unknown().optional(),
  // The owner's facts, checked where they are used.
  durationSeconds: z.unknown().optional(),
  sourceRevision: z.unknown().optional(),
  alertState: z.unknown().optional(),
  physicalStopped: z.unknown().optional(),
  physicalDrained: z.unknown().optional(),
});
export type TimerRow = z.infer<typeof timerRowSchema>;

export const timersSchema = z.looseObject({
  status: z.enum(['observed', 'unavailable']),
  epoch: z.unknown().optional(),
  // Rows without an identity are not timers.
  items: z.array(z.unknown()).default([]).transform(items =>
    items.flatMap(item => {
      const row = timerRowSchema.safeParse(item);
      return row.success ? [row.data] : [];
    }),
  ),
});
export type TimersBlock = z.infer<typeof timersSchema>;

// The timers block, or none observed when it cannot be read.
export const readTimers = (value: unknown): TimersBlock =>
  timersSchema.safeParse(value).data ?? {status: 'unavailable', epoch: undefined, items: []};

export const timerHistorySchema = z.looseObject({
  status: z.string(),
  scope: z.string().optional(),
  items: z.array(z.unknown()).optional(),
});

export const timerAction = z.enum(['timer.start', 'timer.restart', 'timer.cancel', 'timer.adjust']);
export type TimerActionName = z.infer<typeof timerAction>;

export const capabilitiesSchema = z.looseObject({
  timerActions: z.array(z.string()),
  homeRead: z.array(z.string()).optional(),
});

const answerScope = z.looseObject({
  sessionId: z.string().nullish(),
  turnId: z.string().nullish(),
  taskId: z.string().nullish(),
  inputRevision: z.number().nullish(),
});

// podview.snapshot.v1, the SSE stream's payload. The transport has already admitted it (accept()).
export const snapshotSchema = z.looseObject({
  schema: z.literal('podview.snapshot.v1'),
  bootId: z.string(),
  roomId: z.string(),
  revision: z.number().int().min(1),
  timers: timersSchema,
  timerHistory: timerHistorySchema.optional(),
  capabilities: capabilitiesSchema,
  answers: answerScope.optional(),
  // The music provider's generation: a radio action belongs to boot, room and provider generation.
  providerGeneration: z.unknown().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

// A radio action offer (POST …/api/radio/offer): one opaque task/option pair for one intent, until it expires.
export const radioOfferSchema = z.looseObject({
  bootId: z.string(),
  roomId: z.string(),
  taskId: z.string().min(1).max(128),
  optionId: z.string().min(1).max(128),
  expiresAt: z.number().refine(Number.isFinite),
});
export type RadioOffer = z.infer<typeof radioOfferSchema>;

// The owner's receipt (POST …/api/radio/actions). Anything else is UNKNOWN: never resent.
export const radioReceiptSchema = z.looseObject({status: z.enum(['accepted', 'rejected', 'unknown'])});
export type RadioReceipt = z.infer<typeof radioReceiptSchema>;
export const readRadioReceipt = (value: unknown): RadioReceipt =>
  radioReceiptSchema.safeParse(value).data ?? {status: 'unknown'};
