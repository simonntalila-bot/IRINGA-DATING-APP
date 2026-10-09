import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { CallStatus, CallType } from '@prisma/client';
import type { Socket } from 'socket.io';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ChatGateway } from '../chat/chat.gateway';
import { CallsService } from './calls.service';

const userRoom = (userId: string): string => `user:${userId}`;

/**
 * WebRTC signalling.
 *
 * Only the SDP offer/answer and ICE candidates pass through the server - audio
 * and video are peer-to-peer, so no call content is ever stored or logged. That
 * also means we do not need call recording consent to ship calling.
 *
 * Every inbound event re-authorises against CallsService; a peer that was
 * blocked, or whose entitlement was revoked, is dropped mid-call.
 */
@WebSocketGateway({ cors: { origin: '*' }, transports: ['websocket', 'polling'] })
export class CallsGateway {
  @WebSocketServer()
  server!: import('socket.io').Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly chat: ChatGateway,
    private readonly calls: CallsService,
  ) {}

  /** Reuses the chat gateway's authenticated session when both are mounted. */
  async handleConnection(client: Socket): Promise<void> {
    await this.chat.handleConnection(client);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.chat.handleDisconnect(client);
  }

  private userOf(client: Socket): string {
    const session = (client.data as { user?: { userId: string } }).user;
    if (!session) throw new Error('Unauthenticated socket');
    return session.userId;
  }

  private async recheck(userId: string, callId: string): Promise<{ callerId: string; calleeId: string }> {
    const call = await this.prisma.callSession.findFirst({
      where: { id: callId, OR: [{ callerId: userId }, { calleeId: userId }] },
      select: { id: true, callerId: true, calleeId: true, status: true },
    });
    if (!call) throw new Error('Call not found');

    // Entitlement or consent can be withdrawn while a call is live.
    if (await this.users.isBlockedEitherWay(call.callerId, call.calleeId)) {
      await this.calls.end(userId, callId, 'blocked');
      throw new Error('Call ended');
    }

    return { callerId: call.callerId, calleeId: call.calleeId };
  }

  @SubscribeMessage('call:invite')
  async invite(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { calleeId: string; type: CallType; sdpOffer?: string; conversationId?: string },
  ): Promise<{ callId: string }> {
    const callerId = this.userOf(client);

    const call = await this.calls.initiate({
      callerId,
      calleeId: payload.calleeId,
      type: payload.type,
      sdpOffer: payload.sdpOffer,
      conversationId: payload.conversationId,
    });

    this.server.to(userRoom(payload.calleeId)).emit('call:incoming', {
      callId: call.callId,
      fromUserId: callerId,
      type: payload.type,
      sdpOffer: payload.sdpOffer,
      ringTimeoutAt: call.ringTimeoutAt,
    });

    return call;
  }

  @SubscribeMessage('call:accept')
  async accept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; sdpAnswer?: string },
  ): Promise<{ callId: string; status: CallStatus }> {
    const userId = this.userOf(client);
    const result = await this.calls.accept(userId, payload.callId, payload.sdpAnswer);

    const call = await this.prisma.callSession.findUniqueOrThrow({
      where: { id: payload.callId },
      select: { callerId: true, calleeId: true, sdpOffer: true, iceCandidates: true },
    });

    this.server.to(userRoom(call.callerId)).emit('call:accepted', {
      callId: payload.callId,
      sdpAnswer: payload.sdpAnswer,
      // Anything the caller queued before we picked up.
      sdpOffer: call.sdpOffer,
      iceCandidates: call.iceCandidates ?? [],
    });

    return { callId: result.id, status: result.status };
  }

  @SubscribeMessage('call:reject')
  async reject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; reason?: string },
  ): Promise<{ callId: string; status: CallStatus }> {
    const userId = this.userOf(client);
    const result = await this.calls.reject(userId, payload.callId, payload.reason);

    const call = await this.prisma.callSession.findUniqueOrThrow({
      where: { id: payload.callId },
      select: { callerId: true, calleeId: true },
    });

    this.server.to(userRoom(call.callerId === userId ? call.calleeId : call.callerId)).emit('call:ended', {
      callId: payload.callId,
      status: result.status,
    });

    return result;
  }

  @SubscribeMessage('call:hangup')
  async hangup(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string },
  ): Promise<{ callId: string; status: CallStatus }> {
    const userId = this.userOf(client);
    const result = await this.calls.end(userId, payload.callId);

    const call = await this.prisma.callSession.findUniqueOrThrow({
      where: { id: payload.callId },
      select: { callerId: true, calleeId: true },
    });
    this.server.to(userRoom(call.callerId === userId ? call.calleeId : call.callerId)).emit('call:ended', {
      callId: payload.callId,
      status: result.status,
      blocked: result.blocked ?? false,
    });

    return result;
  }

  @SubscribeMessage('call:candidate')
  async candidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; candidate: unknown },
  ): Promise<{ ok: boolean }> {
    const userId = this.userOf(client);
    const { callerId, calleeId } = await this.recheck(userId, payload.callId);

    await this.calls.addCandidate(userId, payload.callId, payload.candidate);

    const peerId = callerId === userId ? calleeId : callerId;
    this.server.to(userRoom(peerId)).emit('call:candidate', {
      callId: payload.callId,
      candidate: payload.candidate,
    });

    return { ok: true };
  }

  /** Let a client buffer candidates it produced before the peer subscribed. */
  @SubscribeMessage('call:pending-candidates')
  async pending(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string },
  ): Promise<{ callId: string; candidates: unknown[] }> {
    const userId = this.userOf(client);
    const candidates = await this.calls.pendingCandidates(payload.callId, userId);
    return { callId: payload.callId, candidates };
  }

  @SubscribeMessage('call:state')
  async state(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string },
  ): Promise<Record<string, unknown>> {
    const userId = this.userOf(client);
    return this.calls.get(userId, payload.callId);
  }
}
