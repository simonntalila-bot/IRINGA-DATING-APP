import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ReportReason } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async reportUser(reporterId: string, reportedUserId: string, reason: ReportReason, details?: string) {
    if (reporterId === reportedUserId) throw new BadRequestException('You cannot report yourself');

    const existing = await this.prisma.report.findFirst({
      where: { reporterId, reportedUserId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) return { reportId: existing.id, duplicate: true };

    const report = await this.prisma.report.create({
      data: { reporterId, reportedUserId, reason, details: details?.slice(0, 1000) },
      select: { id: true, status: true, createdAt: true },
    });
    return { ...report, duplicate: false };
  }

  async reportPost(reporterId: string, reportedPostId: string, reason: ReportReason, details?: string) {
    const post = await this.prisma.post.findFirst({ where: { id: reportedPostId }, select: { id: true } });
    if (!post) throw new NotFoundException('Post not found');

    const report = await this.prisma.report.create({
      data: { reporterId, reportedPostId, reason, details: details?.slice(0, 1000) },
      select: { id: true, status: true },
    });
    return report;
  }

  async myReports(userId: string) {
    return this.prisma.report.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, reason: true, status: true, createdAt: true, reportedUserId: true, reportedPostId: true },
    });
  }

  async openReports(limit = 50) {
    return this.prisma.report.findMany({
      where: { status: { in: ['OPEN', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        reporter: { select: { id: true } },
        reportedUser: { select: { id: true, status: true, profile: { select: { displayName: true } } } },
        reportedPost: { select: { id: true, caption: true } },
      },
    });
  }

  async resolve(adminId: string, reportId: string, resolve: boolean, note?: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: resolve ? 'RESOLVED' : 'DISMISSED',
        resolvedAt: new Date(),
        resolvedById: adminId,
      },
      select: { id: true, status: true },
    });

    await this.prisma.adminLog.create({
      data: {
        adminId,
        action: resolve ? 'report.resolve' : 'report.dismiss',
        entityType: 'Report',
        entityId: reportId,
        meta: note ? { note } : undefined,
      },
    });

    return updated;
  }

  async suspendUser(adminId: string, userId: string, reason?: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    await this.prisma.adminLog.create({
      data: {
        adminId,
        action: 'user.suspend',
        entityType: 'User',
        entityId: userId,
        meta: reason ? { reason } : undefined,
      },
    });
  }
}
