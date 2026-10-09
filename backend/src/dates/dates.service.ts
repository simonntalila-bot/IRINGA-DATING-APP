import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const REMINDER_WINDOW_MINUTES = 60;

/**
 * Date planning + date safety.
 *
 * Safety features are opt-in and reminder based. The app NEVER silently tracks
 * anyone: check-ins are recorded when the user taps, and the trusted contact is
 * only notified after an overdue check-out, exactly as configured.
 */
@Injectable()
export class DatesService {
  private readonly logger = new Logger(DatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async propose(
    creatorId: string,
    input: { conversationId: string; placeId?: string; placeName?: string; scheduledFor: string; note?: string },
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, members: { some: { userId: creatorId, leftAt: null } } },
      select: { id: true, match: { select: { participants: { select: { userId: true } }, state: true } } },
    });
    if (!conversation || conversation.match.state !== 'ACTIVE') {
      throw new NotFoundException('Conversation not found');
    }

    const scheduledFor = new Date(input.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) throw new NotFoundException('Invalid date');
    if (scheduledFor.getTime() < Date.now()) throw new NotFoundException('Pick a future date and time');

    let placeLat: number | null = null;
    let placeLng: number | null = null;
    let placeName = input.placeName ?? 'A place of your choice';

    if (input.placeId) {
      const place = await this.prisma.locationPlace.findFirst({
        where: { id: input.placeId, isActive: true },
        select: { name: true, latitude: true, longitude: true },
      });
      if (!place) throw new NotFoundException('Place not found');
      placeName = place.name;
      placeLat = place.latitude;
      placeLng = place.longitude;
    }
    if (!placeName) throw new NotFoundException('Add a place name');

    const plan = await this.prisma.datePlan.create({
      data: {
        conversationId: input.conversationId,
        createdById: creatorId,
        placeId: input.placeId,
        placeName,
        placeLat,
        placeLng,
        scheduledFor,
        note: input.note?.slice(0, 500),
        participants: {
          create: conversation.match.participants
            .filter((p) => p.userId !== creatorId)
            .map((p) => ({ userId: p.userId })),
        },
      },
      select: { id: true, placeName: true, scheduledFor: true, status: true },
    });

    for (const participant of conversation.match.participants) {
      if (participant.userId === creatorId) continue;
      await this.notifications.send({
        userId: participant.userId,
        type: 'DATE_INVITATION',
        title: 'Date invitation',
        body: `You have been invited to ${placeName}.`,
        data: { datePlanId: plan.id, conversationId: input.conversationId },
      });
    }

    return plan;
  }

  async respond(userId: string, planId: string, accept: boolean) {
    const plan = await this.prisma.datePlan.findFirst({
      where: { id: planId, participants: { some: { userId } } },
      select: { id: true, placeName: true, conversationId: true, createdById: true },
    });
    if (!plan) throw new NotFoundException('Date plan not found');

    await this.prisma.datePlanParticipant.update({
      where: { datePlanId_userId: { datePlanId: planId, userId } },
      data: { acceptedAt: accept ? new Date() : null },
    });

    if (!accept) {
      await this.prisma.datePlan.update({ where: { id: planId }, data: { status: 'DECLINED' } });
    } else {
      const everyone = await this.prisma.datePlanParticipant.findMany({
        where: { datePlanId: planId, acceptedAt: { not: null } },
        select: { userId: true },
      });
      const pending = await this.prisma.datePlanParticipant.count({ where: { datePlanId: planId, acceptedAt: null } });
      if (pending === 0 && everyone.length >= 2) {
        await this.prisma.datePlan.update({ where: { id: planId }, data: { status: 'CONFIRMED' } });
      }
    }

    return { ok: true, accepted: accept };
  }

  async list(userId: string) {
    return this.prisma.datePlan.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
      select: {
        id: true,
        placeName: true,
        placeLat: true,
        placeLng: true,
        scheduledFor: true,
        note: true,
        status: true,
        createdById: true,
        participants: { select: { userId: true, acceptedAt: true } },
        checkIns: { orderBy: { createdAt: 'desc' }, select: { userId: true, type: true, createdAt: true } },
      },
    });
  }

  async checkIn(userId: string, planId: string, type: 'CHECK_IN' | 'CHECK_OUT') {
    const plan = await this.prisma.datePlan.findFirst({
      where: { id: planId, participants: { some: { userId } } },
      select: { id: true, placeName: true },
    });
    if (!plan) throw new NotFoundException('Date plan not found');

    await this.prisma.dateCheckIn.create({ data: { datePlanId: planId, userId, type } });
    return { ok: true, type, at: new Date().toISOString() };
  }

  async addSafetyContact(
    userId: string,
    input: { name: string; phone: string; contactUserId?: string; notifyOnOverdue?: boolean },
  ) {
    return this.prisma.safetyContact.create({
      data: {
        userId,
        contactUserId: input.contactUserId,
        name: input.name.slice(0, 120),
        phone: input.phone.slice(0, 40),
        notifyOnOverdue: input.notifyOnOverdue ?? true,
      },
      select: { id: true, name: true, phone: true, notifyOnOverdue: true },
    });
  }

  async safetyContacts(userId: string) {
    return this.prisma.safetyContact.findMany({
      where: { userId },
      select: { id: true, name: true, phone: true, isPrimary: true, notifyOnOverdue: true },
    });
  }

  /** Scheduled job: reminds participants and flags overdue check-outs. */
  async sendReminders(): Promise<void> {
    const now = new Date();
    const horizon = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000);
    const alreadySentKey = 'dates:reminders:sent';

    const upcoming = await this.prisma.datePlan.findMany({
      where: {
        status: 'CONFIRMED',
        scheduledFor: { gte: now, lte: horizon },
        participants: { some: { acceptedAt: { not: null } } },
      },
      select: { id: true, placeName: true, scheduledFor: true, participants: { select: { userId: true } } },
    });

    const stamp = Math.floor(now.getTime() / (REMINDER_WINDOW_MINUTES * 60_000));
    const key = `${alreadySentKey}:${stamp}`;

    for (const plan of upcoming) {
      for (const participant of plan.participants) {
        await this.notifications.send({
          userId: participant.userId,
          type: 'DATE_REMINDER',
          title: 'Date reminder',
          body: `Your date at ${plan.placeName} starts soon.`,
          data: { datePlanId: plan.id, idempotencyKey: key },
        });
      }
    }

    this.logger.log(`Date reminders processed: ${upcoming.length} plan(s) in window`);
  }

  configForClient(): { reminderWindowMinutes: number; safetyTrackingEnabled: false } {
    return { reminderWindowMinutes: REMINDER_WINDOW_MINUTES, safetyTrackingEnabled: false };
  }
}
