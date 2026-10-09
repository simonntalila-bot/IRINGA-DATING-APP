import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { MaintenanceScheduler, SystemController } from './admin/system.controller';
import { AppConfigModule } from './common/config/app-config.module';
import { CryptoModule } from './common/crypto/encryption.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.service';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { ChatModule } from './chat/chat.module';
import { ContactModule } from './contact/contact.module';
import { DatesModule } from './dates/dates.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { EntitlementModule } from './entitlements/entitlement.module';
import { GeofencingModule } from './geofencing/geofencing.module';
import { HealthModule } from './health/health.module';
import { LocationSharingModule } from './location-sharing/location-sharing.module';
import { LocationsModule } from './locations/locations.module';
import { MatchesModule } from './matches/matches.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PostsModule } from './posts/posts.module';
import { PrivacyModule } from './privacy/privacy.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ReportsModule } from './reports/reports.module';
import { StoriesModule } from './stories/stories.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env.local', '.env'] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'default', ttl: 60_000, limit: 120 },
    ]),
    AppConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,

    // Global policy modules.
    UsersModule,
    NotificationsModule,
    ReportsModule,
    PrivacyModule,

    // Feature modules.
    AuthModule,
    MediaModule,
    PaymentsModule,
    SubscriptionsModule,
    EntitlementModule,
    ProfilesModule,
    LocationsModule,
    GeofencingModule,
    DiscoveryModule,
    MatchesModule,
    ChatModule,
    CallsModule,
    ContactModule,
    VideosModule,
    LocationSharingModule,
    StoriesModule,
    PostsModule,
    DatesModule,
    VerificationModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [SystemController],
  providers: [
    MaintenanceScheduler,
    // Global: throttle -> authenticate. AdminGuard is NOT global; it is applied
    // with @UseGuards(AdminGuard) on the admin controllers only.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
