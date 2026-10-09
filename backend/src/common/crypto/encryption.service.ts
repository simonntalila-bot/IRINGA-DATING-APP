import { Global, Injectable, Module, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app-config';

/**
 * Protection for sensitive identifiers at rest.
 *
 * Phone numbers and WhatsApp numbers are personal data in an adult dating app,
 * so they are never stored in clear text:
 *   - `hash()` produces a keyed HMAC used as a lookup index (login, OTP routing).
 *     Deterministic, but useless without the key.
 *   - `encrypt()` / `decrypt()` use AES-256-GCM with a random IV and an
 *     authentication tag, so tampering is detectable.
 *
 * The key lives in `PHONE_ENCRYPTION_KEY`. In production the app refuses to
 * start without it, because losing it means losing every stored contact.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(config: AppConfig) {
    const secret = config.phoneEncryptionKey;
    this.key = createHmac('sha256', secret).digest();

    if (config.isProduction && !secret) {
      throw new Error('Refusing to start in production: PHONE_ENCRYPTION_KEY is not set');
    }
    if (!secret) {
      this.logger.warn('PHONE_ENCRYPTION_KEY not set - using the JWT secret as the key. Do not do this in production.');
    }
  }

  /** Deterministic index for lookups. Same input -> same output. */
  hash(value: string): string {
    return createHmac('sha256', this.key).update(normalisePhone(value)).digest('hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // version.iv.tag.ciphertext - all base64url so it is URL and JSON safe.
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Unrecognised ciphertext format');
    }

    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Never throws: used on read paths where a corrupt value must not 500. */
  tryDecrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    try {
      return this.decrypt(payload);
    } catch {
      this.logger.error('Failed to decrypt a stored value - it has been tampered with or the key changed');
      return null;
    }
  }

  /** Masks a number for anyone without the entitlement. */
  static mask(value: string | null | undefined): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    if (digits.length < 4) return '***';
    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }

  static equals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}

/** Phone numbers are compared in E.164 form so +255700 vs 255700 hash the same. */
export function normalisePhone(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : `+${digits}`;
}

@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
