import {
  MINIMUM_AGE,
  ageProximityScore,
  calculateAge,
  isAtLeast18,
  isValidDateOfBirth,
} from '../src/common/utils/age.util';
import { assertNotBlocked, buildBlockMap, excludeIds, isBlockedEitherWay } from '../src/common/utils/block.util';

const reference = new Date('2026-06-01T00:00:00.000Z');

describe('age rules', () => {
  it('calculates age correctly around the birthday', () => {
    expect(calculateAge(new Date('2000-06-01T00:00:00.000Z'), reference)).toBe(26);
    expect(calculateAge(new Date('2000-06-02T00:00:00.000Z'), reference)).toBe(25);
  });

  it('blocks under-18 registration', () => {
    expect(isAtLeast18(new Date('2008-12-31T00:00:00.000Z'), reference)).toBe(false);
    expect(isAtLeast18(new Date('2008-06-02T00:00:00.000Z'), reference)).toBe(false);
    expect(isAtLeast18(new Date('2008-06-01T00:00:00.000Z'), reference)).toBe(true);
    expect(MINIMUM_AGE).toBe(18);
  });

  it('rejects impossible dates of birth', () => {
    expect(isValidDateOfBirth(new Date('nope'), reference)).toBe(false);
    expect(isValidDateOfBirth(new Date('2030-01-01T00:00:00.000Z'), reference)).toBe(false);
    expect(isValidDateOfBirth(new Date('1850-01-01T00:00:00.000Z'), reference)).toBe(false);
    expect(isValidDateOfBirth(new Date('1995-01-01T00:00:00.000Z'), reference)).toBe(true);
  });

  it('scores similar ages higher', () => {
    expect(ageProximityScore(26, 28)).toBe(1);
    expect(ageProximityScore(26, 36)).toBeLessThan(1);
    expect(ageProximityScore(26, 60)).toBeGreaterThanOrEqual(0);
  });
});

describe('block policy', () => {
  const map = buildBlockMap({
    blockedByViewer: [{ blockedId: 'blocked-by-me' }],
    blockedViewer: [{ blockerId: 'blocked-me' }],
    hidden: [{ targetId: 'hidden' }],
  });

  it('detects a block in either direction', () => {
    expect(isBlockedEitherWay(map, 'blocked-by-me')).toBe(true);
    expect(isBlockedEitherWay(map, 'blocked-me')).toBe(true);
    expect(isBlockedEitherWay(map, 'friend')).toBe(false);
  });

  it('hides blocked profiles from the blocker with 404', () => {
    expect(() => assertNotBlocked(map, 'blocked-by-me')).toThrow(/not found/i);
  });

  it('hides blocked profiles from the blocked user too', () => {
    expect(() => assertNotBlocked(map, 'blocked-me')).toThrow(/no longer access/i);
  });

  it('excludes blocked and hidden ids from result sets', () => {
    const result = excludeIds(map, ['friend', 'blocked-by-me', 'blocked-me', 'hidden']);
    expect(result).toEqual(['friend']);
  });
});
