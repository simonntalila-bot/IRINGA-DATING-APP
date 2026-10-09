import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';

class SelfieDto {
  @IsUUID()
  mediaId!: string;
}

@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('me')
  status(@CurrentUser() user: AuthUser) {
    return this.verification.status(user.id);
  }

  @Post('selfie')
  @HttpCode(HttpStatus.OK)
  async requestSelfie(@CurrentUser() user: AuthUser, @Body() dto: SelfieDto) {
    const result = await this.verification.requestSelfie(user.id, dto.mediaId);
    const check = await this.verification.runSelfieCheck(user.id, dto.mediaId);
    return { ...result, automatedCheck: check };
  }
}
