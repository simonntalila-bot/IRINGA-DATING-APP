/**
 * Compatibility score.
 *
 * IMPORTANT: this is a ranking heuristic, not science. The API always labels it
 * "compatibility score" and never claims a scientific probability of
 * compatibility. Weights are configurable through environment variables so an
 * admin can tune them later without code changes.
 */

import { ageProximityScore } from '../common/utils/age.util';

export interface CompatibilityWeights {
  goal: number;
  distance: number;
  interests: number;
  age: number;
  language: number;
  activity: number;
}

export const DEFAULT_WEIGHTS: CompatibilityWeights = {
  goal: 30,
  distance: 20,
  interests: 25,
  age: 15,
  language: 5,
  activity: 5,
};

export interface CompatibilityInput {
  ageA: number;
  ageB: number;
  goalA: string;
  goalB: string;
  interestSlugsA: string[];
  interestSlugsB: string[];
  languagesA: string[];
  languagesB: string[];
  distanceKm: number | null;
  maxDistanceKm: number;
  lastActiveA: Date | null;
  lastActiveB: Date | null;
}

export interface CompatibilityResult {
  score: number;
  factors: {
    goal: number;
    distance: number;
    interests: number;
    age: number;
    language: number;
    activity: number;
  };
  commonInterests: string[];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function scoreGoal(goalA: string, goalB: string): number {
  if (!goalA || !goalB) return 0;
  return goalA === goalB ? 1 : 0;
}

export function scoreDistance(distanceKm: number | null, maxDistanceKm: number): number {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return 0.3;
  const cap = Math.max(1, maxDistanceKm);
  return clamp01(1 - distanceKm / cap);
}

/** Jaccard-style overlap, favouring a couple of shared interests over one. */
export function scoreInterests(a: string[], b: string[]): { score: number; common: string[] } {
  const setA = new Set((a ?? []).map((s) => s.toLowerCase()));
  const setB = new Set((b ?? []).map((s) => s.toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return { score: 0, common: [] };

  const common: string[] = [];
  for (const value of setA) {
    if (setB.has(value)) common.push(value);
  }
  const union = new Set([...setA, ...setB]).size;
  return { score: common.length / union, common };
}

export function scoreLanguage(a: string[], b: string[]): number {
  const setA = new Set((a ?? []).map((s) => s.toLowerCase()));
  const setB = new Set((b ?? []).map((s) => s.toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return 0;
  for (const lang of setA) if (setB.has(lang)) return 1;
  return 0;
}

export function scoreActivity(a: Date | null, b: Date | null, now: Date = new Date()): number {
  if (!a || !b) return 0.4;
  const daysA = (now.getTime() - a.getTime()) / 86_400_000;
  const daysB = (now.getTime() - b.getTime()) / 86_400_000;
  const worst = Math.max(daysA, daysB);
  if (worst <= 1) return 1;
  if (worst <= 3) return 0.8;
  if (worst <= 7) return 0.6;
  if (worst <= 21) return 0.35;
  return 0.1;
}

export function computeCompatibilityScore(
  input: CompatibilityInput,
  weights: CompatibilityWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
): CompatibilityResult {
  const goal = scoreGoal(input.goalA, input.goalB);
  const distance = scoreDistance(input.distanceKm, input.maxDistanceKm);
  const interests = scoreInterests(input.interestSlugsA, input.interestSlugsB);
  const age = ageProximityScore(input.ageA, input.ageB);
  const language = scoreLanguage(input.languagesA, input.languagesB);
  const activity = scoreActivity(input.lastActiveA, input.lastActiveB, now);

  const totalWeight =
    weights.goal + weights.distance + weights.interests + weights.age + weights.language + weights.activity;

  const weighted =
    goal * weights.goal +
    distance * weights.distance +
    interests.score * weights.interests +
    age * weights.age +
    language * weights.language +
    activity * weights.activity;

  const score = totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 100);

  return {
    score: Math.min(100, Math.max(0, score)),
    factors: { goal, distance, interests: interests.score, age, language, activity },
    commonInterests: interests.common,
  };
}
