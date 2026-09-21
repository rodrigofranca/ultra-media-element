import { describe, it, expect } from '@jest/globals';
import { normalizeLiveDate } from '../src/core/live-date';

// result-cycle3.md, defect 2 - single shared rule every engine's
// playheadDate (and UltraMediaCore's own extrapolation from one) goes
// through: a Date with a finite getTime(), or null. Never an Invalid Date.
describe('normalizeLiveDate (result-cycle3.md, defect 2)', () => {
  it('passes a valid Date through unchanged', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    expect(normalizeLiveDate(date)).toBe(date);
  });

  it('normalizes an Invalid Date (new Date(NaN)) to null', () => {
    expect(normalizeLiveDate(new Date(NaN))).toBeNull();
  });

  it('passes null/undefined through as null', () => {
    expect(normalizeLiveDate(null)).toBeNull();
    expect(normalizeLiveDate(undefined)).toBeNull();
  });
});
