import { Module } from '@nestjs/common';
import { DatesController } from './dates.controller';
import { DatesService } from './dates.service';

@Module({
  controllers: [DatesController],
  providers: [DatesService],
  exports: [DatesService],
})
export class DatesModule {}
