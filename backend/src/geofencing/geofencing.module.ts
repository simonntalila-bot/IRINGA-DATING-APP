import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { GeofencingController } from './geofencing.controller';

@Module({
  imports: [LocationsModule],
  controllers: [GeofencingController],
})
export class GeofencingModule {}
