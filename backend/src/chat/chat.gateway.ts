import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../common/config/app-config';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { ChatService } from './chat.service';
import type { AccessTokenPayload } from '../auth/tokens.service';
import type { MessageKind } from '@prisma/client';

interface SocketUser {
  userId: string;
}

const roomFor = (userId: string): string => `user:${userId}`;
const conversationRoom = (conversationId: string): string => `conversation:${conversationId}`;

/**
 * Real-time chat.
 *
 * The socket is authenticated during the handshake - there is no "trust the
 * client" path. Every inbound event is authorised against conversation
 * membership server side before anything is broadcast.
 */
@WebSocketGateway({ cors: { origin: '*' }, transports: ['websocket', 'polling'] })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly chat: ChatService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers.authorization?.replace('Bearer ', '') as string | undefined);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.config.jwtSecret });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true, deletedAt: true },
      });
      if (!user || user.deletedAt || user.status === 'BANNED' || user.status === 'DELETED') {
        client.disconnect(true);
        return;
      }

      const session: SocketUser = { userId: user.id };
      (client.data as { user?: SocketUser }).user = session;

      await client.join(roomFor(user.id));
      await this.redis.incrPresence(user.id);
      await this.users.touchActive(user.id);

      client.emit('ready', { userId: user.id });
      this.server.to(roomFor(user.id)).emit('presence', { userId: user.id, online: true });
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const session = (client.data as { user?: SocketUser }).user;
    if (!session) return;

    const remaining = await this.redis.decrPresence(session.userId);
    if (remaining <= 0) {
      this.server.to(roomFor(session.userId)).emit('presence', { userId: session.userId, online: false });
    }
  }

  private userOf(client: Socket): SocketUser {
    const session = (client.data as { user?: SocketUser }).user;
    if (!session) throw new Error('Unauthenticated socket');
    return session;
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(client: Socket, payload: { conversationId: string }): Promise<{ ok: boolean }> {
    const session = this.userOf(client);
    // Throws unless the user is an active member of an active match.
    await this.chat.assertCanAccess(payload.conversationId, session.userId);
    await client.join(conversationRoom(payload.conversationId));
    return { ok: true };
  }

  @SubscribeMessage('message:send')
  async sendMessage(
    client: Socket,
    payload: {
      conversationId: string;
      kind?: MessageKind;
      body?: string;
      clientId?: string;
      replyToId?: string;
      attachmentMediaIds?: string[];
      durationSec?: number;
    },
  ): Promise<Record<string, unknown>> {
    const session = this.userOf(client);

    const message = await this.chat.send({
      conversationId: payload.conversationId,
      senderId: session.userId,
      kind: payload.kind ?? 'TEXT',
      body: payload.body,
      clientId: payload.clientId,
      replyToId: payload.replyToId,
      attachmentMediaIds: payload.attachmentMediaIds,
      durationSec: payload.durationSec,
    });

    this.server.to(conversationRoom(payload.conversationId)).emit('message:new', message);
    return { ok: true, message };
  }

  @SubscribeMessage('message:typing')
  async typing(client: Socket, payload: { conversationId: string; isTyping: boolean }): Promise<{ ok: boolean }> {
    const session = this.userOf(client);
    await this.chat.assertCanAccess(payload.conversationId, session.userId);
    await this.chat.typing(payload.conversationId, session.userId, payload.isTyping);

    client.to(conversationRoom(payload.conversationId)).emit('typing', {
      conversationId: payload.conversationId,
      userId: session.userId,
      isTyping: payload.isTyping,
    });
    return { ok: true };
  }

  @SubscribeMessage('message:read')
  async read(client: Socket, payload: { conversationId: string }): Promise<{ ok: boolean; readAt: string }> {
    const session = this.userOf(client);
    const result = await this.chat.markRead(session.userId, payload.conversationId);
    this.server.to(conversationRoom(payload.conversationId)).emit('message:read', {
      conversationId: payload.conversationId,
      userId: session.userId,
      readAt: result.readAt,
    });
    return result;
  }

  @SubscribeMessage('message:react')
  async react(
    client: Socket,
    payload: { messageId: string; emoji: string; remove?: boolean },
  ): Promise<Record<string, unknown>> {
    const session = this.userOf(client);
    const result = await this.chat.react(session.userId, payload.messageId, payload.emoji, payload.remove === true);
    this.server.emit('message:reaction', { ...result, userId: session.userId });
    return result;
  }

  @SubscribeMessage('typing:state')
  async typingState(
    client: Socket,
    payload: { conversationId: string; userId: string },
  ): Promise<{ isTyping: boolean }> {
    const session = this.userOf(client);
    await this.chat.assertCanAccess(payload.conversationId, session.userId);
    return { isTyping: await this.redis.isTyping(payload.conversationId, payload.userId) };
  }

  /** Consented area event, pushed live. Never contains coordinates. */
  async pushAreaActivity(userId: string, areaLabel: string): Promise<void> {
    this.server.to(roomFor(userId)).emit('area:activity', { area: areaLabel });
  }

  get gatewayServer(): Server {
    return this.server;
  }
}
