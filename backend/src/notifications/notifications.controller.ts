import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

class ListQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

class MarkReadDto {
  @IsString({ each: true })
  ids!: string[];
}

class DeviceDto {
  @IsString()
  @MaxLength(400)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.notifications.list(user.id, query.limit ?? 50, query.cursor);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Patch('read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    await this.notifications.markRead(user.id, dto.ids ?? []);
    return { ok: true };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: AuthUser) {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }

  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto) {
    await this.notifications.registerDevice(user.id, dto.token, dto.platform);
    return { ok: true };
  }

  @Delete('devices/:token')
  @HttpCode(HttpStatus.OK)
  async removeDevice(@Param('token') token: string) {
    await this.notifications.removeDevice(token);
    return { ok: true };
  }
}
