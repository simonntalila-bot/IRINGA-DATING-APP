import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DiscoveryController, SwipesController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { SwipesService } from './swipes.service';

@Module({
  imports: [SubscriptionsModule],
  controllers: [DiscoveryController, SwipesController],
  providers: [DiscoveryService, SwipesService],
  exports: [DiscoveryService, SwipesService],
})
export class DiscoveryModule {}
