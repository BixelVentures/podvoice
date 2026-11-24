// @vitest-environment node
// The committed motion-tokens.css is exactly what the generator writes from tokens.ts.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';
import {TOKENS_CSS, motionTokenCss} from './gen-motion-tokens.mjs';

test('motion-tokens.css is generated from src/lib/motion/tokens.ts (run node scripts/gen-motion-tokens.mjs)', () => {
  expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(motionTokenCss());
});
