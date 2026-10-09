import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CallStatus, CallType, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrivacyService } from '../privacy/privacy.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';

/** How long the callee has to answer before it becomes a missed call. */
export const RING_TIMEOUT_SECONDS = 45;
const MAX_CALL_SECONDS = 60 * 60;

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly privacy: PrivacyService,
    private readonly entitlements: EntitlementService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Who may call whom.
   *
   * Three gates, all server side:
   *   1. an active match (calls are a paid/unlocked contact feature, not random);
   *   2. the callee has opted in to calls (`allowCalls`), which also requires
   *      `allowContactSharing` - turning calls off turns the whole contact tier
   *      off;
   *   3. the caller holds a valid contact entitlement.
   *
   * A block between the two ends the call and stops new ones.
   */
  async canCall(callerId: string, calleeId: string): Promise<{ allowed: boolean; reason: string | null }> {
    if (callerId === calleeId) return { allowed: false, reason: 'SELF_CALL' };

    if (await this.users.isBlockedEitherWay(callerId, calleeId)) {
      return { allowed: false, reason: 'BLOCKED' };
    }

    const match = await this.prisma.match.findFirst({
      where: {
        state: 'ACTIVE',
        participants: { some: { userId: callerId } },
        OR: [{ userAId: calleeId }, { userBId: calleeId }],
      },
      select: { id: true, conversation: { select: { id: true } } },
    });
    if (!match) return { allowed: false, reason: 'NO_MATCH' };

    if (!(await this.privacy.ownerAllowsCalls(calleeId))) {
      return { allowed: false, reason: 'CALLEE_DISABLED_CALLS' };
    }

    if (!(await this.entitlements.canViewPhone(callerId, calleeId))) {
      return { allowed: false, reason: 'NO_CONTACT_ENTITLEMENT' };
    }

    return { allowed: true, reason: null };
  }

  /** Caller rings the callee. One active call per participant pair. */
  async initiate(input: {
    callerId: string;
    calleeId: string;
    type: CallType;
    conversationId?: string;
    sdpOffer?: string;
  }): Promise<{ callId: string; status: CallStatus; ringTimeoutAt: string }> {
    const gate = await this.canCall(input.callerId, input.calleeId);
    if (!gate.allowed) {
      throw new ForbiddenException({ message: 'This call is not permitted', code: gate.reason });
    }

    // Refuse to stack a second ringing call on the same pair.
    const existing = await this.prisma.callSession.findFirst({
      where: {
        status: CallStatus.RINGING,
        OR: [
          { callerId: input.callerId, calleeId: input.calleeId },
          { callerId: input.calleeId, calleeId: input.callerId },
        ],
      },
      select: { id: true },
    });
    if (existing) throw new BadRequestException({ message: 'A call is already ringing', code: 'ALREADY_RINGING' });

    const ringTimeoutAt = new Date(Date.now() + RING_TIMEOUT_SECONDS * 1000);

    const call = await this.prisma.callSession.create({
      data: {
        callerId: input.callerId,
        calleeId: input.calleeId,
        conversationId: input.conversationId ?? null,
        type: input.type,
        status: CallStatus.RINGING,
        sdpOffer: input.sdpOffer ?? null,
        ringTimeoutAt,
      },
      select: { id: true, status: true, ringTimeoutAt: true },
    });

    const callerName = await this.displayName(input.callerId);
    await this.notifications.send({
      userId: input.calleeId,
      type: 'NEW_MESSAGE',
      title: input.type === CallType.VIDEO ? 'Incoming video call' : 'Incoming voice call',
      body: `${callerName} is calling you`,
      data: { callId: call.id, fromUserId: input.callerId, type: input.type },
    });

    this.logger.log(`Call ${call.id} ringing ${input.callerId} -> ${input.calleeId} (${input.type})`);

    return { callId: call.id, status: call.status, ringTimeoutAt: call.ringTimeoutAt.toISOString() };
  }

  /** Callee accepts. The SDP answer travels back over the socket. */
  async accept(calleeId: string, callId: string, sdpAnswer?: string) {
    const call = await this.assertParticipant(callId, calleeId);
    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException({ message: 'This call is no longer ringing', code: 'NOT_RINGING' });
    }
    if (call.calleeId !== calleeId) {
      throw new ForbiddenException('Only the person being called can answer');
    }
    if (call.ringTimeoutAt.getTime() < Date.now()) {
      await this.markMissed(callId);
      throw new BadRequestException({ message: 'This call timed out', code: 'RING_TIMEOUT' });
    }

    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: { status: CallStatus.ACCEPTED, acceptedAt: new Date(), sdpAnswer: sdpAnswer ?? null },
      select: { id: true, status: true, acceptedAt: true },
    });

    return updated;
  }

  async reject(participantId: string, callId: string, reason?: string) {
    const call = await this.assertParticipant(callId, participantId);

    const nextStatus = call.callerId === participantId ? CallStatus.CANCELLED : CallStatus.REJECTED;

    await this.prisma.callSession.update({
      where: { id: callId },
      data: { status: nextStatus, endedAt: new Date(), endReason: reason ?? null },
    });

    return { callId, status: nextStatus };
  }

  /** Hang up from either side. */
  async end(participantId: string, callId: string, reason = 'hangup') {
    const call = await this.assertParticipant(callId, participantId);
    if (call.status === CallStatus.ENDED) return { callId, status: call.status };

    // A block between the two ends immediately kills an in-progress call.
    const blocked = await this.users.isBlockedEitherWay(call.callerId, call.calleeId);

    await this.prisma.callSession.update({
      where: { id: callId },
      data: {
        status: CallStatus.ENDED,
        endedAt: new Date(),
        endReason: blocked ? 'blocked' : reason,
      },
    });

    return { callId, status: CallStatus.ENDED, blocked };
  }

  /**
   * ICE candidates exchanged after the offer/answer. Only a participant may add
   * them, and only while the call is still live.
   */
  async addCandidate(participantId: string, callId: string, candidate: unknown): Promise<void> {
    await this.assertParticipant(callId, participantId);

    const call = await this.prisma.callSession.findUnique({
      where: { id: callId },
      select: { status: true, iceCandidates: true },
    });
    if (!call) throw new NotFoundException('Call not found');

    const live = call.status === CallStatus.RINGING || call.status === CallStatus.ACCEPTED;
    if (!live) throw new BadRequestException('This call has ended');

    const existing = Array.isArray(call.iceCandidates) ? (call.iceCandidates as unknown[]) : [];
    await this.prisma.callSession.update({
      where: { id: callId },
      data: { iceCandidates: [...existing, candidate] as never },
    });
  }

  /** Candidates buffered before the peer joined, so nothing is lost. */
  async pendingCandidates(callId: string, participantId: string): Promise<unknown[]> {
    await this.assertParticipant(callId, participantId);
    const call = await this.prisma.callSession.findUnique({
      where: { id: callId },
      select: { iceCandidates: true },
    });
    return Array.isArray(call?.iceCandidates) ? (call.iceCandidates as unknown[]) : [];
  }

  async get(participantId: string, callId: string) {
    const call = await this.assertParticipant(callId, participantId);
    return this.serialise(call, participantId);
  }

  async history(userId: string, limit = 50) {
    const rows = await this.prisma.callSession.findMany({
      where: { OR: [{ callerId: userId }, { calleeId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        callerId: true,
        calleeId: true,
        type: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        endedAt: true,
        endReason: true,
      },
    });

    const otherIds = rows.map((r) => (r.callerId === userId ? r.calleeId : r.callerId));
    const names = await this.nameMap(otherIds);

    return rows.map((row) => {
      const otherId = row.callerId === userId ? row.calleeId : row.callerId;
      return {
        callId: row.id,
        direction: row.callerId === userId ? 'OUTGOING' : 'INCOMING',
        otherUserId: otherId,
        otherName: names.get(otherId) ?? 'Unknown',
        type: row.type,
        status: row.status,
        startedAt: row.createdAt,
        acceptedAt: row.acceptedAt,
        endedAt: row.endedAt,
        endReason: row.endReason,
      };
    });
  }

  /** Maintenance: ring timeouts and calls that ran too long. */
  async sweep(): Promise<{ missed: number; ended: number }> {
    const now = new Date();

    const timedOut = await this.prisma.callSession.findMany({
      where: { status: CallStatus.RINGING, ringTimeoutAt: { lt: now } },
      select: { id: true },
    });
    for (const call of timedOut) await this.markMissed(call.id);

    const tooLong = await this.prisma.callSession.findMany({
      where: {
        status: CallStatus.ACCEPTED,
        acceptedAt: { lt: new Date(now.getTime() - MAX_CALL_SECONDS * 1000) },
      },
      select: { id: true },
    });
    if (tooLong.length > 0) {
      await this.prisma.callSession.updateMany({
        where: { id: { in: tooLong.map((c) => c.id) } },
        data: { status: CallStatus.ENDED, endedAt: now, endReason: 'duration_limit' },
      });
    }

    return { missed: timedOut.length, ended: tooLong.length };
  }

  private async markMissed(callId: string): Promise<void> {
    await this.prisma.callSession.update({
      where: { id: callId },
      data: { status: CallStatus.MISSED, endedAt: new Date(), endReason: 'no_answer' },
    });
  }

  private async assertParticipant(callId: string, userId: string) {
    const call = await this.prisma.callSession.findFirst({
      where: { id: callId, OR: [{ callerId: userId }, { calleeId: userId }] },
      select: {
        id: true,
        callerId: true,
        calleeId: true,
        conversationId: true,
        type: true,
        status: true,
        sdpOffer: true,
        sdpAnswer: true,
        iceCandidates: true,
        ringTimeoutAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  private serialise(call: Awaited<ReturnType<CallsService['assertParticipant']>>, viewerId: string) {
    return {
      callId: call.id,
      type: call.type,
      status: call.status,
      isCaller: call.callerId === viewerId,
      otherUserId: call.callerId === viewerId ? call.calleeId : call.callerId,
      // The offer goes to the callee, the answer to the caller.
      sdp: call.callerId === viewerId ? call.sdpAnswer : call.sdpOffer,
      conversationId: call.conversationId,
      createdAt: call.createdAt,
      acceptedAt: call.acceptedAt,
      ringTimeoutAt: call.ringTimeoutAt,
    };
  }

  private async displayName(userId: string): Promise<string> {
    const map = await this.nameMap([userId]);
    return map.get(userId) ?? 'Someone';
  }

  private async nameMap(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.profile.findMany({
      where: { userId: { in: [...new Set(userIds)] } },
      select: { userId: true, displayName: true },
    });
    return new Map(rows.map((r) => [r.userId, r.displayName]));
  }

  /** Type helper for the socket gateway. */
  static whereForParticipant(userId: string): Prisma.CallSessionWhereInput {
    return { OR: [{ callerId: userId }, { calleeId: userId }] };
  }
}
