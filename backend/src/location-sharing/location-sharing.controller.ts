import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { ALLOWED_SHARE_MINUTES, LocationSharingService } from './location-sharing.service';

class RequestShareDto {
  @IsInt()
  @IsIn(ALLOWED_SHARE_MINUTES)
  minutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

class RespondShareDto {
  @IsBoolean()
  accept!: boolean;

  @IsOptional()
  @IsInt()
  @IsIn(ALLOWED_SHARE_MINUTES)
  minutes?: number;
}

@Controller('location-sharing')
export class LocationSharingController {
  constructor(private readonly sharing: LocationSharingService) {}

  /** Owner: am I accepting requests, and for how long at most? */
  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.sharing.settings(user.id);
  }

  /** Owner: who can see my location right now. */
  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.sharing.activeRecipients(user.id);
  }

  /** Owner: requests waiting for my decision. */
  @Get('requests')
  requests(@CurrentUser() user: AuthUser) {
    return this.sharing.incomingRequests(user.id);
  }

  /** Recipient: ask the owner. Grants nothing by itself. */
  @Post('request/:ownerId')
  @HttpCode(HttpStatus.OK)
  request(
    @CurrentUser() user: AuthUser,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: RequestShareDto,
  ) {
    return this.sharing.request(user.id, ownerId, dto.minutes, dto.note);
  }

  @Post('requests/:shareId/respond')
  @HttpCode(HttpStatus.OK)
  respond(
    @CurrentUser() user: AuthUser,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: RespondShareDto,
  ) {
    return this.sharing.respond(user.id, shareId, dto.accept, dto.minutes);
  }

  /** Owner: stop sharing immediately. */
  @Post('stop/:recipientId')
  @HttpCode(HttpStatus.OK)
  stop(@CurrentUser() user: AuthUser, @Param('recipientId', ParseUUIDPipe) recipientId: string) {
    return this.sharing.stop(user.id, recipientId);
  }

  /**
   * Recipient: the owner's shared area. 403 unless a live permission exists.
   * Note this returns an AREA NAME plus the grant's expiry - never the owner's
   * coordinates.
   */
  @Get('with/:ownerId')
  live(@CurrentUser() user: AuthUser, @Param('ownerId', ParseUUIDPipe) ownerId: string) {
    return this.sharing.livePosition(user.id, ownerId);
  }
}
