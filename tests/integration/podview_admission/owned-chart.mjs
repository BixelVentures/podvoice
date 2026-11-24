// The panel's own answer admission (podview/src/lib/answers/owner.ts, run as TypeScript by Node) of a typed chart
// answer. The card draws one meter per row from 0 (or the lowest value) to the highest (AnswerCard.test.tsx).
import assert from 'node:assert/strict';
import {ownedAnswers} from '../../../podview/src/lib/answers/owner.ts';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const payload = JSON.parse(raw);
const answer = ownedAnswers(payload.answers, payload.snapshot, 0, payload.now).items[0];
assert.equal(answer.kind, 'chart');
const values = answer.content.items.map(item => item.value);
assert.deepEqual(values, payload.expectedValues);
assert.equal(typeof answer.content.unit, 'string');
const lower = Math.min(0, ...values);
const upper = Math.max(lower < 0 ? 0 : 1, ...values);
assert.equal(answer.content.sources[0].kind, 'owner_receipt');
assert.deepEqual(answer.allowedActions, []);
process.stdout.write(JSON.stringify({values, domain: [lower, upper], actions: []}));
