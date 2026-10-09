import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MessageKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MatchesService } from '../matches/matches.service';

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body?: string;
  clientId?: string;
  replyToId?: string;
  attachmentMediaIds?: string[];
  durationSec?: number;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly matches: MatchesService,
  ) {}

  /**
   * Every protected operation re-checks membership AND that the match is still
   * active AND that nobody blocked anybody. A block instantly kills messaging.
   */
  async assertCanAccess(conversationId: string, userId: string): Promise<{ otherUserId: string }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        match: {
          select: {
            state: true,
            userAId: true,
            userBId: true,
            participants: { select: { userId: true } },
          },
        },
        members: { where: { userId }, select: { userId: true, leftAt: true } },
      },
    });

    if (!conversation || conversation.members.length === 0 || conversation.members[0].leftAt) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.match.state !== 'ACTIVE') {
      throw new ForbiddenException('This conversation is no longer active');
    }

    const participantIds = conversation.match.participants.map((p) => p.userId);
    const otherUserId = participantIds.find((id) => id !== userId);
    if (!otherUserId) throw new ForbiddenException('Not a participant');

    const blocked = await this.prisma.block.count({
      where: {
        OR: [
          { blockerId: userId, blockedId: otherUserId },
          { blockerId: otherUserId, blockedId: userId },
        ],
      },
    });
    if (blocked > 0) throw new ForbiddenException('Messaging is not available');

    return { otherUserId };
  }

  async conversations(userId: string, limit = 50) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, leftAt: null },
      take: Math.min(limit, 100),
      select: {
        isMuted: true,
        isArchived: true,
        isPinned: true,
        conversation: {
          select: {
            id: true,
            updatedAt: true,
            match: {
              select: {
                userAId: true,
                userBId: true,
                compatibilityScore: true,
                participants: { select: { userId: true } },
              },
            },
            members: {
              select: { userId: true },
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                kind: true,
                body: true,
                createdAt: true,
                senderId: true,
                attachments: { select: { mediaId: true } },
              },
            },
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });

    const otherIds = memberships
      .map((m) => m.conversation.match.participants.map((p) => p.userId).find((id) => id !== userId))
      .filter((id): id is string => !!id);

    const profiles = await this.prisma.profile.findMany({
      where: { userId: { in: otherIds } },
      select: {
        userId: true,
        displayName: true,
        lastActiveAt: true,
        photos: { orderBy: { position: 'asc' }, take: 1, select: { mediaId: true } },
      },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));

    return Promise.all(
      memberships.map(async (m) => {
        const otherId = m.conversation.match.participants.map((p) => p.userId).find((id) => id !== userId);
        if (!otherId) return null;
        const profile = byUser.get(otherId);
        const last = m.conversation.messages[0] ?? null;
        const unread = await this.prisma.message.count({
          where: {
            conversationId: m.conversation.id,
            senderId: otherId,
            deletedAt: null,
            ...(await this.readCutoff(m.conversation.id, userId)),
          },
        });

        return {
          conversationId: m.conversation.id,
          isMuted: m.isMuted,
          isArchived: m.isArchived,
          isPinned: m.isPinned,
          compatibilityScore: m.conversation.match.compatibilityScore,
          lastMessageAt: m.conversation.updatedAt,
          unreadMessages: unread,
          isOnline: await this.redis.isUserOnline(otherId),
          lastSeenAt: profile?.lastActiveAt ?? null,
          other: {
            userId: otherId,
            displayName: profile?.displayName ?? 'Unknown',
            photoMediaId: profile?.photos[0]?.mediaId ?? null,
          },
          lastMessage: last
            ? {
                id: last.id,
                kind: last.kind,
                body: last.kind === 'TEXT' ? last.body : null,
                mediaIds: last.attachments.map((a) => a.mediaId),
                senderId: last.senderId,
                createdAt: last.createdAt,
              }
            : null,
        };
      }),
    ).then((rows) => rows.filter((r): r is NonNullable<typeof r> => r !== null));
  }

  async messages(userId: string, conversationId: string, opts: { limit?: number; before?: string } = {}) {
    await this.assertCanAccess(conversationId, userId);

    const limit = Math.min(opts.limit ?? 50, 100);
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
      include: {
        sender: { select: { id: true, profile: { select: { displayName: true } } } },
        attachments: { select: { id: true, mediaId: true, position: true } },
        reactions: { select: { emoji: true, userId: true } },
        replyTo: {
          select: {
            id: true,
            body: true,
            kind: true,
            deletedAt: true,
            sender: { select: { profile: { select: { displayName: true } } } },
          },
        },
      },
    });

    return rows.reverse().map((row) => this.serialise(row, userId));
  }

  async send(input: SendMessageInput) {
    const { otherUserId } = await this.assertCanAccess(input.conversationId, input.senderId);

    if (input.kind === 'TEXT' && !input.body?.trim()) {
      throw new BadRequestException('Message body is required');
    }
    if (input.kind !== 'TEXT' && (!input.attachmentMediaIds || input.attachmentMediaIds.length === 0)) {
      throw new BadRequestException('Attach the media you just uploaded');
    }

    if (input.attachmentMediaIds?.length) {
      const owned = await this.prisma.media.count({
        where: { id: { in: input.attachmentMediaIds }, ownerId: input.senderId, status: { not: 'deleted' } },
      });
      if (owned !== input.attachmentMediaIds.length) {
        throw new BadRequestException('One or more attachments are not yours');
      }
    }

    if (input.replyToId) {
      const parent = await this.prisma.message.findFirst({
        where: { id: input.replyToId, conversationId: input.conversationId },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('Cannot reply to a message in another conversation');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: input.senderId,
          kind: input.kind,
          body: input.body?.slice(0, 8000),
          clientId: input.clientId,
          replyToId: input.replyToId,
          durationSec: input.durationSec,
          attachments: input.attachmentMediaIds?.length
            ? {
                create: input.attachmentMediaIds.map((mediaId, index) => ({ mediaId, position: index })),
              }
            : undefined,
        },
        include: {
          sender: { select: { id: true, profile: { select: { displayName: true } } } },
          attachments: { select: { id: true, mediaId: true, position: true } },
          reactions: { select: { emoji: true, userId: true } },
        },
      });

      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      await tx.match.updateMany({
        where: { conversation: { id: input.conversationId } },
        data: { lastMessageAt: new Date() },
      });

      return created;
    });

    // Offline-safe notification: the row exists in Postgres first, so a device
    // that was offline still sees the message when it comes back.
    const otherMembership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: input.conversationId, userId: otherUserId } },
      select: { isMuted: true },
    });

    if (!otherMembership?.isMuted) {
      await this.notifications.send({
        userId: otherUserId,
        type: input.kind === 'AUDIO' ? 'VOICE_MESSAGE' : 'NEW_MESSAGE',
        title: 'New message',
        body: input.kind === 'TEXT' ? (input.body ?? '').slice(0, 120) : `Sent a ${input.kind.toLowerCase()}`,
        data: { conversationId: input.conversationId, messageId: message.id },
      });
    }

    await this.matches.markConversationRead(input.senderId, input.conversationId);

    return this.serialise(message, input.senderId);
  }

  async edit(userId: string, messageId: string, body: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, kind: true, createdAt: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('You can only edit your own message');
    if (message.kind !== 'TEXT') throw new BadRequestException('Only text messages can be edited');

    const ageMs = Date.now() - message.createdAt.getTime();
    if (ageMs > 15 * 60_000) throw new BadRequestException('Messages can only be edited within 15 minutes');

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: body.slice(0, 8000), editedAt: new Date() },
      include: {
        sender: { select: { id: true, profile: { select: { displayName: true } } } },
        attachments: { select: { id: true, mediaId: true, position: true } },
        reactions: { select: { emoji: true, userId: true } },
      },
    });
    return this.serialise(updated, userId);
  }

  async remove(userId: string, messageId: string, forEveryone: boolean): Promise<{ messageId: string }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('You can only delete your own message');

    if (forEveryone) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), body: null },
      });
      await this.prisma.messageReaction.deleteMany({ where: { messageId } });
    }

    return { messageId };
  }

  async react(userId: string, messageId: string, emoji: string, remove = false) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    await this.assertCanAccess(message.conversationId, userId);

    if (remove) {
      await this.prisma.messageReaction.deleteMany({ where: { messageId, userId } });
    } else {
      await this.prisma.messageReaction.upsert({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
        create: { messageId, userId, emoji },
        update: {},
      });
    }

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });
    return { messageId, reactions };
  }

  async markRead(userId: string, conversationId: string) {
    await this.assertCanAccess(conversationId, userId);
    await this.prisma.conversationReadState.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    return { ok: true, readAt: new Date().toISOString() };
  }

  async search(userId: string, conversationId: string, term: string) {
    await this.assertCanAccess(conversationId, userId);
    if (term.trim().length < 2) throw new BadRequestException('Search term is too short');

    return this.prisma.message.findMany({
      where: { conversationId, kind: 'TEXT', body: { contains: term, mode: 'insensitive' }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        body: true,
        createdAt: true,
        sender: { select: { profile: { select: { displayName: true } } } },
      },
    });
  }

  async updatePreferences(
    userId: string,
    conversationId: string,
    prefs: { isMuted?: boolean; isArchived?: boolean; isPinned?: boolean },
  ) {
    await this.assertCanAccess(conversationId, userId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: {
        ...(prefs.isMuted != null ? { isMuted: prefs.isMuted } : {}),
        ...(prefs.isArchived != null ? { isArchived: prefs.isArchived } : {}),
        ...(prefs.isPinned != null ? { isPinned: prefs.isPinned } : {}),
      },
    });
    return { ok: true };
  }

  async typing(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    await this.redis.setTyping(conversationId, userId, isTyping);
  }

  private async readCutoff(conversationId: string, userId: string) {
    const state = await this.prisma.conversationReadState.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });
    return state ? { createdAt: { gt: state.lastReadAt } } : {};
  }

  private serialise(
    row: {
      id: string;
      conversationId?: string;
      senderId?: string;
      kind: MessageKind;
      body: string | null;
      clientId?: string | null;
      durationSec?: number | null;
      deletedAt?: Date | null;
      editedAt?: Date | null;
      createdAt: Date;
      sender: { id: string; profile: { displayName: string } | null };
      attachments?: Array<{ id: string; mediaId: string; position: number }>;
      reactions?: Array<{ emoji: string; userId: string }>;
      replyTo?: {
        id: string;
        body: string | null;
        kind: MessageKind;
        deletedAt: Date | null;
        sender: { profile: { displayName: string } | null };
      } | null;
    },
    viewerId: string,
  ) {
    const deleted = !!row.deletedAt;
    return {
      id: row.id,
      conversationId: row.conversationId,
      clientId: row.clientId ?? null,
      kind: row.kind,
      body: deleted ? null : row.body,
      durationSec: row.durationSec ?? null,
      isMine: row.sender.id === viewerId,
      sender: { id: row.sender.id, displayName: row.sender.profile?.displayName ?? 'Unknown' },
      attachments: (row.attachments ?? []).map((a) => ({ mediaId: a.mediaId, position: a.position })),
      reactions: row.reactions ?? [],
      replyTo: row.replyTo
        ? {
            id: row.replyTo.id,
            body: row.replyTo.deletedAt ? null : row.replyTo.body,
            kind: row.replyTo.kind,
            senderName: row.replyTo.sender.profile?.displayName ?? 'Unknown',
          }
        : null,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
    };
  }
}
