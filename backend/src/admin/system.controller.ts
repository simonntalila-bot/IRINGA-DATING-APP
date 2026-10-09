import { Controller, Get, HttpCode, HttpStatus, Injectable, Post } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StoriesService } from '../stories/stories.service';
import { DatesService } from '../dates/dates.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stories: StoriesService,
    private readonly notifications: NotificationsService,
    private readonly dates: DatesService,
  ) {}

  /** Run background maintenance now. Used by ops and by the scheduled jobs. */
  @Post('maintenance')
  @HttpCode(HttpStatus.OK)
  async runMaintenance() {
    const expiredStories = await this.stories.purgeExpired();
    await this.notifications.cleanup();
    await this.dates.sendReminders();
    return { ok: true, expiredStories, ranAt: new Date().toISOString() };
  }

  @Get('stats')
  async stats() {
    return {
      users: await this.prisma.user.count({ where: { deletedAt: null } }),
      matches: await this.prisma.match.count({ where: { state: 'ACTIVE' } }),
      conversations: await this.prisma.conversation.count(),
      messages: await this.prisma.message.count(),
      locationNodes: await this.prisma.locationNode.count({ where: { isActive: true } }),
      places: await this.prisma.locationPlace.count({ where: { isActive: true } }),
      cache: this.redis.isOnline ? 'redis' : 'memory',
    };
  }
}

/** Hourly background jobs. Kept small and idempotent on purpose. */
@Injectable()
export class MaintenanceScheduler {
  constructor(
    private readonly stories: StoriesService,
    private readonly notifications: NotificationsService,
    private readonly dates: DatesService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    await this.stories.purgeExpired();
    await this.dates.sendReminders();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async daily(): Promise<void> {
    await this.notifications.cleanup();
  }
}
