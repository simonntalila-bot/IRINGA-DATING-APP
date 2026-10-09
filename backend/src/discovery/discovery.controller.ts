import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { DiscoveryService, type DiscoveryMode } from './discovery.service';
import { SwipesService } from './swipes.service';

class DiscoverQueryDto {
  @IsOptional()
  @IsIn(['nearby', 'recommended', 'new', 'active'])
  mode?: DiscoveryMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(99)
  minAge?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(99)
  maxAge?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxDistanceKm?: number;

  @IsOptional()
  @IsString()
  relationshipGoal?: string;

  @IsOptional()
  @IsString()
  interests?: string;

  @IsOptional()
  @IsString()
  onlyVerified?: string;

  @IsOptional()
  @IsString()
  onlyActiveRecent?: string;

  @IsOptional()
  @IsString()
  onlineOnly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  discover(@CurrentUser() user: AuthUser, @Query() query: DiscoverQueryDto) {
    return this.discovery.discover(user.id, {
      mode: query.mode,
      minAge: query.minAge,
      maxAge: query.maxAge,
      maxDistanceKm: query.maxDistanceKm,
      relationshipGoal: query.relationshipGoal,
      interests: query.interests
        ? query.interests
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      onlyVerified: query.onlyVerified === 'true',
      onlyActiveRecent: query.onlyActiveRecent === 'true',
      onlineOnly: query.onlineOnly === 'true',
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('likes-received')
  likesReceived(@CurrentUser() user: AuthUser) {
    return this.discovery.likesReceived(user.id);
  }

  @Post('undo')
  @HttpCode(HttpStatus.OK)
  undo(@CurrentUser() user: AuthUser) {
    return this.discovery.undoLastSwipe(user.id);
  }
}

class SwipeDto {
  @IsUUID()
  targetId!: string;

  @IsIn(['PASS', 'LIKE', 'SUPER_LIKE'])
  type!: 'PASS' | 'LIKE' | 'SUPER_LIKE';
}

@Controller('swipes')
export class SwipesController {
  constructor(private readonly swipes: SwipesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthUser, @Body() dto: SwipeDto) {
    return this.swipes.swipe(user.id, dto.targetId, dto.type);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  async bulk(
    @CurrentUser() user: AuthUser,
    @Body() body: { swipes: Array<{ targetId: string; type: 'PASS' | 'LIKE' | 'SUPER_LIKE' }> },
  ) {
    const results = [];
    for (const s of body.swipes ?? []) {
      // Sequential so the free-tier like limit is enforced correctly.
      results.push(await this.swipes.swipe(user.id, s.targetId, s.type));
    }
    return { results };
  }
}
