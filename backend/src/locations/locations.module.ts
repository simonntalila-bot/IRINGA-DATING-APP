import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { LocationEventService } from '../geofencing/location-event.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService, LocationEventService],
  exports: [LocationsService, LocationEventService],
})
export class LocationsModule {}
