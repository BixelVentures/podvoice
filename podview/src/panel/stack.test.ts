// The screen stack's poses (stack.tsx): where each screen rests and where a screen built for a move starts. The
// motion between them (springs, the swipe back) is proven in WebKit by tests/browser/ha_panel_actual_e2e.cjs.
import {describe, expect, it} from 'vitest';
import {initial, target, WIDTH} from './stack';
import type {Role} from './stack';

const ROLES: Role[] = ['center', 'under', 'below', 'after'];

describe('screen stack poses', () => {
  it('a push slides in over the whole column from the right; the screen it covers waits a third to the left', () => {
    expect(initial('center', false, 1)).toEqual({x: WIDTH, fade: 1});
    expect(target('center', false)).toEqual({x: 0, fade: 1});
    expect(target('under', false)).toEqual({x: -0.3 * WIDTH, fade: 1});
    expect(target('after', false)).toEqual({x: WIDTH, fade: 1});
    // A back to a screen that was let go builds it on the left, where a back reveals it from.
    expect(initial('center', false, -1)).toEqual({x: -0.3 * WIDTH, fade: 1});
  });

  it('reduced motion moves nothing: every screen rests in place and only fades', () => {
    for (const role of ROLES) {
      expect(target(role, true).x).toBe(0);
      expect(initial(role, true, 1).x).toBe(0);
      expect(initial(role, true, -1).x).toBe(0);
    }
    expect(target('center', true).fade).toBe(1);
    for (const role of ROLES.filter(role => role !== 'center')) expect(target(role, true).fade).toBeLessThan(0.01);
  });

  it('Hjem on the page\'s first render is simply there', () => {
    expect(initial('center', false, null)).toEqual({x: 0, fade: 1});
  });
});
