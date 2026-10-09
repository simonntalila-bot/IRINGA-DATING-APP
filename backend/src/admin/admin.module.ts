import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EntitlementModule } from '../entitlements/entitlement.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReportsModule } from '../reports/reports.module';
import { VerificationModule } from '../verification/verification.module';
import { VideosModule } from '../videos/videos.module';
import { AdminVideosController } from '../videos/videos.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminMonetisationController } from './admin-monetisation.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [JwtModule.register({}), ReportsModule, VerificationModule, PaymentsModule, EntitlementModule, VideosModule],
  controllers: [AdminAuthController, AdminController, AdminVideosController, AdminMonetisationController],
  providers: [AdminService, AdminAuthService],
  exports: [AdminService, AdminAuthService],
})
export class AdminModule {}
