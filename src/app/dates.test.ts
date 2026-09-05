import { describe, expect, it } from 'vitest';
import { describeDate, describeWhen } from './dates';

const now = new Date(2026, 8, 2); // 2 September 2026, local time

describe('describeDate', () => {
  it('uses the word a person would say for recent days', () => {
    expect(describeDate('2026-09-02', 'en-GB', now)).toBe('Today');
    expect(describeDate('2026-09-01', 'en-GB', now)).toBe('Yesterday');
    expect(describeDate('2026-09-03', 'en-GB', now)).toBe('Tomorrow');
  });

  it('names the weekday within the past week', () => {
    expect(describeDate('2026-08-31', 'en-GB', now)).toBe('Monday');
  });

  it('gives a real date once it is older than a week', () => {
    expect(describeDate('2026-07-14', 'en-GB', now)).toBe('14 July');
  });

  it('adds the year only when it is a different one', () => {
    expect(describeDate('2025-07-14', 'en-GB', now)).toBe('14 July 2025');
  });

  it('follows the locale', () => {
    expect(describeDate('2026-07-14', 'de-DE', now)).toBe('14. Juli');
  });

  it('reads a date as local, so an early morning is not yesterday', () => {
    // Built naively from an ISO string, a UTC date west of Greenwich lands on
    // the previous day and every entry reads as "Yesterday".
    expect(describeDate('2026-09-02', 'en-GB', new Date(2026, 8, 2, 0, 30))).toBe('Today');
    expect(describeDate('2026-09-02', 'en-GB', new Date(2026, 8, 2, 23, 30))).toBe('Today');
  });

  it('hands back anything it cannot read rather than showing a broken date', () => {
    expect(describeDate('not a date', 'en-GB', now)).toBe('not a date');
  });
});

describe('putting a date inside a sentence', () => {
  const now = new Date('2026-09-05T12:00:00');

  it('drops the preposition where English drops it', () => {
    expect(describeWhen('2026-09-05', 'en-IE', now)).toBe('today');
    expect(describeWhen('2026-09-04', 'en-IE', now)).toBe('yesterday');
    expect(describeWhen('2026-09-06', 'en-IE', now)).toBe('tomorrow');
  });

  it('keeps it where English keeps it', () => {
    expect(describeWhen('2026-09-02', 'en-IE', now)).toBe('on Wednesday');
    expect(describeWhen('2026-01-15', 'en-IE', now)).toBe('on 15 January');
  });
});
