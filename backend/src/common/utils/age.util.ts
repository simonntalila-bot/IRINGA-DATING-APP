/**
 * Age helpers. Minimum age for the app is 18 and is enforced server side.
 */

export const MINIMUM_AGE = 18;

export function calculateAge(dateOfBirth: Date, reference: Date = new Date()): number {
  let age = reference.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = reference.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function isAtLeast18(dateOfBirth: Date, reference: Date = new Date()): boolean {
  return calculateAge(dateOfBirth, reference) >= MINIMUM_AGE;
}

export function isValidDateOfBirth(dateOfBirth: Date, reference: Date = new Date()): boolean {
  if (Number.isNaN(dateOfBirth.getTime())) return false;
  if (dateOfBirth.getTime() > reference.getTime()) return false;
  return calculateAge(dateOfBirth, reference) <= 120;
}

/** Years between two ages, used by the compatibility score. */
export function ageProximityScore(ageA: number, ageB: number, toleranceYears = 6): number {
  const distance = Math.abs(ageA - ageB);
  if (distance <= toleranceYears) return 1;
  const overflow = distance - toleranceYears;
  return Math.max(0, 1 - overflow / 15);
}
