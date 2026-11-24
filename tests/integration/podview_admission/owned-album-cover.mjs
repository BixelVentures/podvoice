// The panel's own answer and source admission (podview/src/lib/answers/owner.ts, run as TypeScript by Node) of an
// album cover answer. How the card draws it, and falls back when the picture fails, is in AnswerCard.test.tsx.
import assert from 'node:assert/strict';
import {ownedAnswers, ownedSource} from '../../../podview/src/lib/answers/owner.ts';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const payload = JSON.parse(raw);
const answer = ownedAnswers(payload.answers, payload.snapshot, 0, payload.now).items[0];
assert.equal(answer.kind, 'sourced-image');
assert.equal(answer.provenance.kind, 'owner_sources');
const image = answer.content.image;
assert.equal(image.url, payload.expectedUrl);
assert.equal(image.alt, `Albumomslag til ${payload.expectedName}`);
assert.equal(image.caption, payload.expectedName);
assert.equal(image.kind, 'album_cover');
assert.equal(image.credit, 'Spotify');
assert.equal(answer.content.sources.length, 1);
assert.equal(answer.content.sources[0].receiptId, answer.receiptId);
const source = ownedSource(payload.source, answer.receiptId, payload.now, payload.snapshot);
assert.equal(source.family, 'sourced-image');
assert.equal(source.sourceText, payload.source.sourceText);
assert.ok(source.sourceText.includes(payload.expectedUri));
assert.ok(source.sourceText.includes(payload.expectedUrl));
process.stdout.write(JSON.stringify({family: answer.kind, credit: 'Omslag · Spotify', source: source.sourceText,
  actions: answer.allowedActions}));
