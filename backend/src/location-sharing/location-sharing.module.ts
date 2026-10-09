import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlements/entitlement.module';
import { LocationSharingController } from './location-sharing.controller';
import { LocationSharingService } from './location-sharing.service';

@Module({
  imports: [EntitlementModule],
  controllers: [LocationSharingController],
  providers: [LocationSharingService],
  exports: [LocationSharingService],
})
export class LocationSharingModule {}
