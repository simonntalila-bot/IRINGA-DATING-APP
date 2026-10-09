import { Controller, Get, Query } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { LocationEventService } from './location-event.service';
import { UsersService } from '../users/users.service';

class HistoryQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller('geofencing')
export class GeofencingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LocationEventService,
    private readonly users: UsersService,
  ) {}

  /**
   * My own location state. This is the ONLY endpoint that returns coordinates,
   * and only ever to the account they belong to.
   */
  @Get('my-location')
  async myLocation(@CurrentUser() user: AuthUser) {
    const [state, record, prefs] = await Promise.all([
      this.events.currentState(user.id),
      this.prisma.userLocation.findUnique({
        where: { userId: user.id },
        select: { latitude: true, longitude: true, accuracyM: true, recordedAt: true, source: true },
      }),
      this.users.privacySettings(user.id),
    ]);

    return {
      ...state,
      // Self-visibility only. Never reuse this shape for another user.
      mine: record,
      privacy: prefs,
    };
  }

  @Get('history')
  async history(@CurrentUser() user: AuthUser, @Query() query: HistoryQueryDto) {
    return this.prisma.userLocationEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 20, 100),
      select: { id: true, areaName: true, kind: true, createdAt: true, nodeId: true },
    });
  }
}
