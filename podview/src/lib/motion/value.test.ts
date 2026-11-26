import {describe, expect, it} from 'vitest';
import {progressAt} from './value';

describe('the timer ring from its deadline', () => {
  it('is the share of the duration left at that moment, clamped to 0–100', () => {
    expect(progressAt(10_000, 10, 5_000)).toBe(50);
    expect(progressAt(10_000, 10, 7_500)).toBe(25);
    expect(progressAt(10_000, 10, 20_000)).toBe(0);
    expect(progressAt(10_000, 10, -5_000)).toBe(100);
  });
});
