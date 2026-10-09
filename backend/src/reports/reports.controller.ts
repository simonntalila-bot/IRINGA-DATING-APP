import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ReportReason } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

const REASONS: ReportReason[] = [
  'FAKE_PROFILE',
  'SCAM',
  'HARASSMENT',
  'SPAM',
  'INAPPROPRIATE_CONTENT',
  'UNDERAGE',
  'THREAT',
  'OFF_PLATFORM_SOLICITATION',
  'OTHER',
];

class ReportDto {
  @IsIn(REASONS)
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('users/:userId')
  @HttpCode(HttpStatus.CREATED)
  reportUser(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ReportDto) {
    return this.reports.reportUser(user.id, userId, dto.reason, dto.details);
  }

  @Post('posts/:postId')
  @HttpCode(HttpStatus.CREATED)
  reportPost(@CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: ReportDto) {
    return this.reports.reportPost(user.id, postId, dto.reason, dto.details);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.reports.myReports(user.id);
  }
}
