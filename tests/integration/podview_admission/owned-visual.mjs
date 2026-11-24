// The panel's own answer admission (podview/src/lib/answers/owner.ts, run as TypeScript by Node) on the actual Python
// owner's serialized payload. The card's drawing is covered by Vitest (podview/src/panel/screens/AnswerCard.test.tsx).
import assert from 'node:assert/strict';
import {ownedAnswers} from '../../../podview/src/lib/answers/owner.ts';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const payload = JSON.parse(raw);
const answer = ownedAnswers(payload.answers, payload.snapshot, 0, payload.now).items[0];
assert.equal(answer.kind, 'fact-card');
assert.equal(answer.content.summary, payload.expectedQuery);
assert.equal(answer.content.facts.length, 1);
assert.equal(answer.content.facts[0].value, payload.expectedValue);
assert.equal(answer.content.sources[0].kind, 'owner_receipt');
assert.equal(answer.content.sources[0].url, undefined);
process.stdout.write(JSON.stringify({fact: payload.expectedValue, readOnly: true, actions: answer.allowedActions ?? []}));
