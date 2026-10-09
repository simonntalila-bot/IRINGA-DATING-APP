import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { EncryptionService } from '../common/crypto/encryption.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  RequestOtpDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { contextFrom } from './request-context';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, contextFrom(req));
  }

  @Public()
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.target, dto.purpose);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifyPhone(dto.target, dto.code, contextFrom(req));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, contextFrom(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.rotate(dto.refreshToken, contextFrom(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto & { code: string }) {
    await this.auth.resetPasswordWithCode(dto.phone, dto.code, dto.newPassword);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto) {
    await this.auth.logout(dto.refreshToken, dto.allDevices === true, user.id);
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true, sessionsRevoked: true };
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.loginHistory(user.id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeDevice(user.id, id);
    return { ok: true };
  }

  @Get('me/export')
  exportData(@CurrentUser() user: AuthUser) {
    return this.auth.exportMyData(user.id);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@CurrentUser() user: AuthUser) {
    await this.auth.deleteAccount(user.id);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        status: true,
        phoneVerifiedAt: true,
        createdAt: true,
        profile: {
          select: {
            id: true,
            displayName: true,
            gender: true,
            relationshipGoal: true,
            bio: true,
            profileCompletePct: true,
          },
        },
      },
    });

    const own = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { phoneEncrypted: true, whatsappEncrypted: true },
    });

    if (!record) return null;

    // A user always sees their own number, masked in the UI but recoverable by
    // nobody else through this endpoint.
    return {
      ...record,
      phoneMasked: EncryptionService.mask(this.encryption.tryDecrypt(own?.phoneEncrypted)),
      hasWhatsapp: !!own?.whatsappEncrypted,
    };
  }
}
