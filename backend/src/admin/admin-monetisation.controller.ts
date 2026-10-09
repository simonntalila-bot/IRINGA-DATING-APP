import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AdminRole, EntitlementType } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { AdminRoles } from '../common/decorators/admin-roles.decorator';
import { PaymentsService } from '../payments/payments.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { AdminAuthService } from './admin-auth.service';
import { VideosService } from '../videos/videos.service';

class ReasonDto {
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  reason!: string;
}

class GrantDto {
  @IsString()
  userId!: string;

  @IsIn(['FEATURE_FLAG', 'CONTACT_UNLOCK', 'BOOST'])
  type!: 'FEATURE_FLAG' | 'CONTACT_UNLOCK' | 'BOOST';

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  reason!: string;
}

class RangeDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/**
 * Monetisation and sensitive-data administration (spec sections 26 and 27).
 *
 * Separate from the location controller because these routes carry a different
 * risk profile: they expose revenue and personal contact data.
 */
@Controller('admin/monetisation')
export class AdminMonetisationController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly entitlements: EntitlementService,
    private readonly adminAuth: AdminAuthService,
    private readonly videos: VideosService,
  ) {}

  /** Revenue split by product, plus today's figure (spec section 27). */
  @Get('revenue')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async revenue(@Query() query: RangeDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);

    const range = await this.payments.revenueSummary(from, to);

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = await this.payments.revenueSummary(dayStart, new Date());

    const byType = range.byType;
    return {
      currency: range.currency,
      range: { from: range.from, to: range.to },
      totalSuccessful: range.totalSuccessful,
      totalAmountMinor: range.totalAmountMinor,
      failedOrCancelled: range.failedOrCancelled,
      refunded: range.refunded,
      revenueByProduct: {
        contactUnlocks: byType.CONTACT_UNLOCK ?? { count: 0, amountMinor: 0 },
        premiumVideos: byType.VIDEO_PURCHASE ?? { count: 0, amountMinor: 0 },
        subscriptions: byType.PREMIUM_SUBSCRIPTION ?? { count: 0, amountMinor: 0 },
        boosts: byType.BOOST ?? { count: 0, amountMinor: 0 },
      },
      today: { totalAmountMinor: today.totalAmountMinor, totalSuccessful: today.totalSuccessful },
      videoStats: await this.videos.adminStats(),
    };
  }

  /**
   * Reading somebody's phone number requires SUPER_ADMIN/ADMIN, a written
   * reason of at least 8 characters, and writes a `sensitive_access_logs` row.
   * Moderators and support staff are refused.
   */
  @Post('users/:userId/contact-read')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  contactRead(@CurrentUser() admin: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ReasonDto) {
    return this.adminAuth.readContactForSubject(admin.id, admin.adminRole as AdminRole, userId, dto.reason);
  }

  /** Audit trail of sensitive reads and entitlement grants. */
  @Get('sensitive-access')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.MODERATOR)
  sensitiveAccess() {
    return this.adminAuth.listSensitiveAccess(200);
  }

  /** Manual feature-flag grant (support tooling). Always audited. */
  @Post('entitlements')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async grant(@CurrentUser() admin: AuthUser, @Body() body: GrantDto) {
    const result = await this.entitlements.grant(body.userId, body.type as EntitlementType, body.resourceId ?? null);
    await this.adminAuth.logSensitiveAccess({
      actorId: admin.id,
      actorRole: admin.adminRole ?? null,
      subjectId: body.userId,
      action: 'entitlement.grant',
      reason: body.reason,
    });
    return result;
  }
}
