// zod schemas for the PodVoice server payloads the React screens read. The server API is unchanged; these
// describe what PodView accepts. Fields a screen does not read pass through untouched (looseObject), so the
// legacy shell, which still reads the rest of the snapshot, sees exactly what the server sent.
import {z} from 'zod';

// Native timer revisions are decimal strings of at most 24 digits.
export const sourceRevision = z.string().regex(/^(0|[1-9][0-9]{0,23})$/);
const durationSeconds = z.number().int().min(1).max(86400);

export const timerRowSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  secondsLeft: z.number().refine(Number.isFinite),
  status: z.enum(['running', 'paused', 'finished']),
  durationSeconds: durationSeconds.optional(),
  sourceRevision: sourceRevision.optional(),
  alertState: z.string().nullish(),
  physicalStopped: z.boolean().nullish(),
  physicalDrained: z.boolean().nullish(),
});
export type TimerRow = z.infer<typeof timerRowSchema>;

export const timersSchema = z.looseObject({
  status: z.enum(['observed', 'unavailable']),
  epoch: z.unknown(),
  // Rows the screen cannot show are dropped, as before (liveScene filtered them).
  items: z.array(z.unknown()).transform(items =>
    items.flatMap(item => {
      const row = timerRowSchema.safeParse(item);
      return row.success ? [row.data] : [];
    }),
  ),
});
export type TimersBlock = z.infer<typeof timersSchema>;

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
});
export type Snapshot = z.infer<typeof snapshotSchema>;

// POST actions: the explicit 409 refusal (nothing happened) …
export const timerRefusalSchema = z.strictObject({
  ok: z.literal(false),
  retryAllowed: z.literal(false),
  error: z.enum([
    'invalid_action',
    'control_not_paired',
    'invalid_request',
    'timer_unavailable',
    'stale_action',
    'unsupported_action',
    'request_capacity',
  ]),
});

// … and the receipt. `ok` is true exactly when the server accepted the action.
export const timerReceiptSchema = z
  .looseObject({
    requestId: z.string(),
    ok: z.boolean(),
    outcome: z.enum(['accepted', 'unknown', 'rejected']),
    retryAllowed: z.literal(false),
    timerId: z.string().optional(),
    deltaSeconds: z.number().optional(),
    expectedSourceRevision: z.string().optional(),
    sourceRevision: z.string().optional(),
    durationSeconds: z.number().optional(),
    secondsLeft: z.number().optional(),
    status: z.string().optional(),
  })
  .refine(receipt => receipt.ok === (receipt.outcome === 'accepted'));
export type TimerReceiptBody = z.infer<typeof timerReceiptSchema>;
