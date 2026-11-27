import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {hits} from '../../panel/stack';
import {installHitGuard, LOCK_CHECK_MS} from './hit-guard';

describe('the lock watchdog', () => {
  let remove: () => void = () => undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    window.__podviewLocks = [];
    remove = installHitGuard();
  });
  afterEach(() => {
    remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });
  const layer = (opacity: string) => {
    const node = document.createElement('div');
    node.dataset.screen = 'lights';
    node.style.opacity = opacity;
    const button = document.createElement('button');
    node.append(button);
    document.body.append(node);
    return {node, button};
  };

  it('an invisible layer that is still a target a moment after the tap is a lock', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {button} = layer('0.001');
    button.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    vi.advanceTimersByTime(LOCK_CHECK_MS);
    expect(window.__podviewLocks).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[podview] lock'));
    error.mockRestore();
  });

  it('a layer arriving (visible by the check) or one that let go of taps is no lock', () => {
    const arriving = layer('0.01');
    arriving.button.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    arriving.node.style.opacity = '1';
    const leaving = layer('0.01');
    leaving.button.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    // (pointer-events is inherited in a browser; happy-dom does not inherit it)
    leaving.button.style.pointerEvents = 'none';
    vi.advanceTimersByTime(LOCK_CHECK_MS);
    expect(window.__podviewLocks).toEqual([]);
  });

  it('a stack screen takes taps only while it is the shown one and drawn at least half', () => {
    expect(hits('center', 1)).toBe('auto');
    expect(hits('center', 0.5)).toBe('auto');
    expect(hits('center', 0.001)).toBe('none');
    expect(hits('under', 1)).toBe('none');
    expect(hits('after', 0.9)).toBe('none');
  });
});
