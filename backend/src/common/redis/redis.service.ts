import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Thin Redis wrapper used for caching, presence, typing state, rate limiting
 * and OTP throttling.
 *
 * Redis is NOT the source of truth for anything critical. When REDIS_URL is
 * not configured (or the server is unreachable) the service transparently falls
 * back to an in-process map so local development and CI work without Redis.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private memory = new Map<string, { value: string; expiresAt: number | null }>();
  private online = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not set - using in-memory cache (development only)');
      return;
    }

    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });

    this.client.on('ready', () => {
      this.online = true;
      this.logger.log('Redis connected');
    });
    this.client.on('error', (err: Error) => {
      this.online = false;
      this.logger.warn(`Redis unavailable, falling back to memory: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  get isOnline(): boolean {
    return this.online;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.memory.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client && this.online) {
      try {
        return await this.client.get(key);
      } catch {
        this.online = false;
      }
    }
    this.sweep();
    return this.memory.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client && this.online) {
      try {
        if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
        else await this.client.set(key, value);
        return;
      } catch {
        this.online = false;
      }
    }
    this.sweep();
    this.memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.client && this.online) {
      try {
        await this.client.del(...keys);
        return;
      } catch {
        this.online = false;
      }
    }
    keys.forEach((k) => this.memory.delete(k));
  }

  /** SET key value NX EX ttl - returns true when the key was created. */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.client && this.online) {
      try {
        const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch {
        this.online = false;
      }
    }
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (this.client && this.online) {
      try {
        const value = await this.client.incr(key);
        if (value === 1 && ttlSeconds) await this.client.expire(key, ttlSeconds);
        return value;
      } catch {
        this.online = false;
      }
    }
    const current = Number((await this.get(key)) ?? '0') || 0;
    const next = current + 1;
    const existing = this.memory.get(key);
    await this.set(key, String(next), ttlSeconds ?? existing?.expiresAt ?? undefined);
    return next;
  }

  async ttl(key: string): Promise<number> {
    if (this.client && this.online) {
      try {
        return await this.client.ttl(key);
      } catch {
        this.online = false;
      }
    }
    const entry = this.memory.get(key);
    if (!entry?.expiresAt) return -1;
    return Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
  }

  /** Live socket count for a user. Falls back to a per-process counter. */
  async incrPresence(userId: string): Promise<number> {
    return this.incr(`presence:${userId}`, 120);
  }

  async decrPresence(userId: string): Promise<number> {
    const next = (await this.incr(`presence:${userId}`, 120)) - 1;
    if (next <= 0) {
      await this.del(`presence:${userId}`);
      return 0;
    }
    await this.set(`presence:${userId}`, String(next), 120);
    return next;
  }

  async isUserOnline(userId: string): Promise<boolean> {
    return (await this.get(`presence:${userId}`)) !== null;
  }

  /** Short-lived typing flag, e.g. conversation:{id}:typing:{userId}. */
  async setTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    const key = `typing:${conversationId}:${userId}`;
    if (isTyping) await this.set(key, '1', 5);
    else await this.del(key);
  }

  async isTyping(conversationId: string, userId: string): Promise<boolean> {
    return (await this.get(`typing:${conversationId}:${userId}`)) !== null;
  }

  /** Simple fixed-window rate limiter. */
  async hitRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const count = await this.incr(`rl:${key}`, windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }
}
