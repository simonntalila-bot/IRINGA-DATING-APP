import {
  computeCompatibilityScore,
  DEFAULT_WEIGHTS,
  scoreActivity,
  scoreDistance,
  scoreGoal,
  scoreInterests,
  scoreLanguage,
} from '../src/discovery/compatibility.util';

const now = new Date('2026-01-15T00:00:00.000Z');

const base = {
  ageA: 26,
  ageB: 27,
  goalA: 'SERIOUS_DATING',
  goalB: 'SERIOUS_DATING',
  interestSlugsA: ['music', 'travel', 'cooking'],
  interestSlugsB: ['music', 'travel', 'sports'],
  languagesA: ['sw', 'en'],
  languagesB: ['sw', 'en'],
  distanceKm: 4,
  maxDistanceKm: 50,
  lastActiveA: new Date('2026-01-14T00:00:00.000Z'),
  lastActiveB: new Date('2026-01-14T12:00:00.000Z'),
};

describe('scoreGoal', () => {
  it('is 1 for the same goal and 0 otherwise', () => {
    expect(scoreGoal('MARRIAGE', 'MARRIAGE')).toBe(1);
    expect(scoreGoal('MARRIAGE', 'FRIENDSHIP')).toBe(0);
    expect(scoreGoal('', '')).toBe(0);
  });
});

describe('scoreDistance', () => {
  it('decreases with distance', () => {
    expect(scoreDistance(0, 50)).toBe(1);
    expect(scoreDistance(25, 50)).toBeCloseTo(0.5, 5);
    expect(scoreDistance(50, 50)).toBe(0);
  });

  it('is neutral when the distance is unknown', () => {
    expect(scoreDistance(null, 50)).toBe(0.3);
  });
});

describe('scoreInterests', () => {
  it('returns the shared interests', () => {
    const result = scoreInterests(['music', 'travel', 'cooking'], ['music', 'travel', 'sports']);
    expect(result.common.sort()).toEqual(['music', 'travel']);
    expect(result.score).toBeCloseTo(2 / 4, 5);
  });

  it('is case insensitive', () => {
    expect(scoreInterests(['Music'], ['music']).score).toBe(1);
  });

  it('is zero when one side has no interests', () => {
    expect(scoreInterests([], ['music']).score).toBe(0);
  });
});

describe('scoreLanguage', () => {
  it('is 1 when a language overlaps', () => {
    expect(scoreLanguage(['sw', 'en'], ['en'])).toBe(1);
  });

  it('is 0 when nothing overlaps or data is missing', () => {
    expect(scoreLanguage(['en'], ['sw'])).toBe(0);
    expect(scoreLanguage([], ['sw'])).toBe(0);
  });
});

describe('scoreActivity', () => {
  it('rewards recent activity', () => {
    const recent = new Date('2026-01-15T00:00:00.000Z');
    const old = new Date('2025-11-01T00:00:00.000Z');
    expect(scoreActivity(recent, recent, now)).toBe(1);
    expect(scoreActivity(recent, old, now)).toBeLessThan(1);
  });

  it('falls back to a neutral value when one user never activated', () => {
    expect(scoreActivity(null, null, now)).toBe(0.4);
  });
});

describe('computeCompatibilityScore', () => {
  it('returns an integer between 0 and 100', () => {
    const result = computeCompatibilityScore(base, DEFAULT_WEIGHTS, now);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('scores a strong match high', () => {
    const strong = computeCompatibilityScore(
      { ...base, distanceKm: 1, interestSlugsB: ['music', 'travel', 'cooking'] },
      DEFAULT_WEIGHTS,
      now,
    );
    expect(strong.score).toBeGreaterThan(70);
    expect(strong.commonInterests).toHaveLength(3);
  });

  it('scores a poor match low', () => {
    const poor = computeCompatibilityScore(
      {
        ...base,
        goalB: 'FRIENDSHIP',
        languagesB: ['fr'],
        interestSlugsB: ['skydiving'],
        distanceKm: 90,
        maxDistanceKm: 50,
        ageB: 55,
        lastActiveB: new Date('2024-01-01T00:00:00.000Z'),
      },
      DEFAULT_WEIGHTS,
      now,
    );
    expect(poor.score).toBeLessThan(45);
  });

  it('respects admin-configurable weights', () => {
    const goalOnly = computeCompatibilityScore(
      { ...base, goalB: 'FRIENDSHIP' },
      { goal: 100, distance: 0, interests: 0, age: 0, language: 0, activity: 0 },
      now,
    );
    expect(goalOnly.score).toBe(0);
  });

  it('does not crash when optional data is missing', () => {
    const sparse = computeCompatibilityScore(
      {
        ageA: 20,
        ageB: 20,
        goalA: 'MARRIAGE',
        goalB: 'MARRIAGE',
        interestSlugsA: [],
        interestSlugsB: [],
        languagesA: [],
        languagesB: [],
        distanceKm: null,
        maxDistanceKm: 50,
        lastActiveA: null,
        lastActiveB: null,
      },
      DEFAULT_WEIGHTS,
      now,
    );
    expect(sparse.score).toBeGreaterThanOrEqual(0);
  });
});
