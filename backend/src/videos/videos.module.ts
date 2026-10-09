import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlements/entitlement.module';
import { MediaModule } from '../media/media.module';
import { PaymentsModule } from '../payments/payments.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

/**
 * Only the user-facing controller lives here. AdminVideosController is
 * registered in AdminModule (which imports this module) so it inherits the same
 * VideosService instance instead of a second copy.
 */
@Module({
  imports: [PaymentsModule, EntitlementModule, MediaModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService, MediaModule],
})
export class VideosModule {}
