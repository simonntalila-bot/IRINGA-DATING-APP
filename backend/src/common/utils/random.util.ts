import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('hex');

export const randomOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Short, URL-safe public handle used in share links (e.g. /p/9f3a2b). */
export const publicHandle = (): string => randomUUID().replace(/-/g, '').slice(0, 12);

export const nowPlusSeconds = (seconds: number): Date => new Date(Date.now() + seconds * 1000);

export const nowPlusDays = (days: number): Date => new Date(Date.now() + days * 86_400_000);

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}
