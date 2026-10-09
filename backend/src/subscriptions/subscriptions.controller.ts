import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

class SubscribeDto {
  @IsIn(['PREMIUM', 'VIP'])
  tier!: 'PREMIUM' | 'VIP';

  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}

class BoostDto {
  @IsInt()
  @Min(30)
  @Max(180)
  minutes!: number;

  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('me')
  status(@CurrentUser() user: AuthUser) {
    return this.subscriptions.status(user.id);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.subscriptions.startSubscription(user.id, dto.tier, dto.idempotencyKey);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: AuthUser) {
    await this.subscriptions.cancel(user.id);
    return { ok: true };
  }

  @Post('boosts')
  @HttpCode(HttpStatus.OK)
  boost(@CurrentUser() user: AuthUser, @Body() dto: BoostDto) {
    return this.subscriptions.activateBoost(user.id, dto.minutes, dto.idempotencyKey);
  }
}
