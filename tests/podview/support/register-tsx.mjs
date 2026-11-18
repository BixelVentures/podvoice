// Lets the pre-React node:test suite import modules that now come from TypeScript/TSX
// (React screens). Each such test retires when its screen's Vitest tests replace it.
import {register} from 'node:module';

register('./tsx-hooks.mjs', import.meta.url);
