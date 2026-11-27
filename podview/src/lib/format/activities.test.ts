import {describe, expect, it} from 'vitest';
import {activityContext, activityWhen} from './activities';

// Copenhagen is UTC+1 in November.
const at = (iso: string) => new Date(iso);

describe('the activity tiles’ hints come from the clock and the weather only', () => {
  it('cooking time is the first two evening hours, and Madlavning is the suggestion', () => {
    expect(activityContext(at('2026-11-24T16:30:00Z'), null)).toEqual({hints: {cooking: 'Nu: 17–19'},
      suggested: 'cooking'});
    expect(activityContext(at('2026-11-24T18:05:00Z'), null).hints.cooking).toBeUndefined();
  });
  it('Fest names Friday and Saturday, and is the suggestion on those evenings', () => {
    const friday = activityContext(at('2026-11-27T19:30:00Z'), null);
    expect(friday.hints.party).toBe('Fredag');
    expect(friday.suggested).toBe('party');
    expect(activityContext(at('2026-11-26T19:30:00Z'), null)).toEqual({hints: {sleep: 'I aften'},
      suggested: 'sleep'});
  });
  it('Hygge says the weather that keeps you in; Fokus is a weekday’s working hours', () => {
    expect(activityContext(at('2026-11-24T12:00:00Z'), 'rainy')).toEqual({
      hints: {hygge: 'Regnvejr', focus: 'Hverdag'}, suggested: 'hygge'});
    expect(activityContext(at('2026-11-24T12:00:00Z'), 'sunny')).toEqual({hints: {focus: 'Hverdag'},
      suggested: 'focus'});
  });
  it('with nothing real to say, no hint and no suggestion', () => {
    expect(activityContext(at('2026-11-29T05:00:00Z'), 'sunny')).toEqual({hints: {}, suggested: null});
  });
});

describe('»Jeres seneste stemninger« times', () => {
  const now = at('2026-11-27T13:00:00Z');
  it('today, yesterday, this week, older', () => {
    expect(activityWhen('2026-11-27T08:12:00Z', now)).toBe('I dag 09.12');
    expect(activityWhen('2026-11-26T19:31:00Z', now)).toBe('I går 20.31');
    expect(activityWhen('2026-11-24T16:05:00Z', now)).toBe('Tirsdag 17.05');
    expect(activityWhen('2026-11-12T16:05:00Z', now)).toBe('12. nov. 17.05');
    expect(activityWhen('nonsense', now)).toBe('');
  });
});
