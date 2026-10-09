import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { ContactUnlockService } from './contact-unlock.service';

class PurchaseDto {
  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}

class SharingDto {
  @IsBoolean()
  allowContactSharing!: boolean;

  @IsOptional()
  @IsBoolean()
  allowWhatsAppSharing?: boolean;
}

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactUnlockService) {}

  /** Price + whether it is already owned. Never returns the number itself. */
  @Get('unlock/:userId/quote')
  quote(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.contact.quote(user.id, userId);
  }

  @Get('unlock/:userId/status')
  status(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.contact.status(user.id, userId);
  }

  @Post('unlock/:userId')
  @HttpCode(HttpStatus.OK)
  purchase(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: PurchaseDto) {
    return this.contact.purchase(user.id, userId, dto.idempotencyKey);
  }

  /** Contact details - only when entitled AND consented by the owner. */
  @Get('card/:userId')
  card(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.contact.contactCard(user.id, userId);
  }

  @Post('sharing')
  @HttpCode(HttpStatus.OK)
  async setSharing(@CurrentUser() user: AuthUser, @Body() dto: SharingDto) {
    await this.contact.setOwnerSharing(user.id, dto.allowContactSharing, dto.allowWhatsAppSharing);
    return { ok: true };
  }

  @Post('sharing/whatsapp')
  @HttpCode(HttpStatus.OK)
  async setWhatsApp(@CurrentUser() user: AuthUser, @Body() dto: { allowWhatsAppSharing: boolean }) {
    await this.contact.setWhatsApp(user.id, dto.allowWhatsAppSharing);
    return { ok: true };
  }
}
