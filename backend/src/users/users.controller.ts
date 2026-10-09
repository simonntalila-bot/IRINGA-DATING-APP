import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LocationVisibility } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

class UpdatePrivacyDto {
  @IsOptional()
  @IsIn(Object.values(LocationVisibility))
  locationVisibility?: LocationVisibility;

  @IsOptional()
  @IsBoolean()
  shareAreaWithMatches?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAreaActivityAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPlaceAlerts?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  discoveryRadiusKm?: number;
}

class BlockDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me/privacy')
  getPrivacy(@CurrentUser() user: AuthUser) {
    return this.users.privacySettings(user.id);
  }

  @Patch('me/privacy')
  updatePrivacy(@CurrentUser() user: AuthUser, @Body() dto: UpdatePrivacyDto) {
    return this.users.updatePrivacySettings(user.id, dto);
  }

  @Get('me/blocks')
  listBlocked(@CurrentUser() user: AuthUser) {
    return this.users.listBlocked(user.id);
  }

  @Post('me/blocks/:targetId')
  @HttpCode(HttpStatus.CREATED)
  async block(
    @CurrentUser() user: AuthUser,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() dto: BlockDto,
  ) {
    await this.users.blockUser(user.id, targetId, dto.reason);
    return { ok: true };
  }

  @Delete('me/blocks/:targetId')
  @HttpCode(HttpStatus.OK)
  async unblock(@CurrentUser() user: AuthUser, @Param('targetId', ParseUUIDPipe) targetId: string) {
    await this.users.unblockUser(user.id, targetId);
    return { ok: true };
  }

  @Post('me/hidden/:targetId')
  @HttpCode(HttpStatus.CREATED)
  async hide(@CurrentUser() user: AuthUser, @Param('targetId', ParseUUIDPipe) targetId: string) {
    await this.users.hideProfile(user.id, targetId);
    return { ok: true };
  }

  @Delete('me/hidden/:targetId')
  @HttpCode(HttpStatus.OK)
  async unhide(@CurrentUser() user: AuthUser, @Param('targetId', ParseUUIDPipe) targetId: string) {
    await this.users.unhideProfile(user.id, targetId);
    return { ok: true };
  }
}
