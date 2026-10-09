import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PushService } from './push.service';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
}

/**
 * Notifications are always persisted first (Postgres = source of truth), then
 * pushed best-effort. A device that is offline still sees the notification in
 * the in-app list, and the client never claims delivery without a server ack.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async send(input: NotificationInput): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 500),
        data: input.data ? (input.data as never) : undefined,
      },
    });

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: input.userId, isActive: true },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const data = Object.fromEntries(Object.entries(input.data ?? {}).map(([key, value]) => [key, String(value)]));

    await this.push.send(
      tokens.map((t) => ({
        token: t.token,
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 500),
        data: { type: input.type, ...data },
      })),
    );
  }

  async notifyAreaArrival(userId: string, areaLabel: string): Promise<void> {
    await this.send({
      userId,
      type: 'AREA_ACTIVITY_MATCH',
      title: 'Nearby in Iringa',
      body: `You are around ${areaLabel}. Dating-friendly spots are nearby.`,
      data: { area: areaLabel },
    });
  }

  async list(userId: string, limit = 50, cursor?: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        isRead: true,
        createdAt: true,
      },
    });
    return rows;
  }

  async markRead(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async registerDevice(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, isActive: true },
    });
  }

  async removeDevice(token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({ where: { token }, data: { isActive: false } });
  }

  /** Cron helper: purge expired push tokens and old notifications. */
  async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const removed = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff }, isRead: true },
    });
    this.logger.log(`Notification cleanup removed ${removed.count} rows`);
  }
}
