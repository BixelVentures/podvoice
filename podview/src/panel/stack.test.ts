// The screen stack's looks (stack.tsx): how a layer looks at each point `p` of a move, and the rect of the surface
// a Hjem widget grows on. The motion between them (the spring, cold equal to warm, that nothing crosses the player
// column, that there is no swipe back) is proven in WebKit by tests/browser/ha_panel_actual_e2e.cjs.
import {describe, expect, it} from 'vitest';
import {COLUMN, CONTENT_OUT, look, RECEDE_OPACITY, RECEDE_SCALE, SCREEN_IN, surfaceRect, WAITING, WIDTH} from './stack';

describe('screen stack looks', () => {
  it('a screen not shown waits unseen, a shown one is simply there', () => {
    for (const upper of [true, false]) for (const grow of [true, false]) {
      expect(look(0, upper, grow, false)).toEqual({opacity: WAITING, y: 0, scale: 1});
      expect(look(1, upper, grow, false)).toEqual({opacity: 1, y: 0, scale: 1});
    }
  });

  it('a cross-fade fades only the screen above; the one below stays whole under it', () => {
    expect(look(0.5, true, false, false)).toEqual({opacity: 0.5, y: 0, scale: 1});
    expect(look(0.5, false, false, false)).toEqual({opacity: 1, y: 0, scale: 1});
  });

  it('a growing widget: the screen comes in over the last 60 % with a settle, Hjem recedes', () => {
    expect(look(SCREEN_IN, true, true, false).opacity).toBeLessThan(0.01);
    const late = look(0.7, true, true, false);
    expect(late.opacity).toBeCloseTo(0.5);
    expect(late.y).toBeCloseTo(4);
    const hjem = look(0.004, false, true, false);
    expect(hjem.opacity).toBeCloseTo(RECEDE_OPACITY, 2);
    expect(hjem.scale).toBeCloseTo(RECEDE_SCALE, 3);
    expect(CONTENT_OUT).toBeLessThanOrEqual(SCREEN_IN);
  });

  it('reduced motion only fades: nothing moves or scales', () => {
    for (const p of [0.2, 0.5, 0.9]) for (const upper of [true, false]) {
      const pose = look(p, upper, true, true);
      expect([pose.y, pose.scale]).toEqual([0, 1]);
    }
  });

  it('the surface starts on the widget exactly and ends on the screen\'s area', () => {
    const widget = {x: 380, y: 240, w: 172, h: 220};
    const hjem = {w: COLUMN, h: 716};
    expect(surfaceRect(0, widget, hjem, {w: COLUMN, h: 716})).toEqual(widget);
    expect(surfaceRect(1, widget, hjem, {w: COLUMN, h: 716})).toEqual({x: 0, y: 0, w: COLUMN, h: 716});
    expect(surfaceRect(1, widget, hjem, {w: WIDTH, h: 716})).toEqual({x: 0, y: 0, w: WIDTH, h: 716});
    // Halfway it is between the two, inside the area.
    const half = surfaceRect(0.5, widget, hjem, {w: COLUMN, h: 716});
    expect(half.x + half.w).toBeLessThanOrEqual(COLUMN);
  });
});
