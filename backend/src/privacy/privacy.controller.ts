import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Gender, LocationVisibility, type RelationshipGoal } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { PrivacyService } from './privacy.service';

class UpdatePrivacyDto {
  @IsOptional()
  @IsBoolean()
  showMyProfile?: boolean;

  @IsOptional()
  @IsBoolean()
  showApproximateArea?: boolean;

  @IsOptional()
  @IsBoolean()
  allowContactSharing?: boolean;

  @IsOptional()
  @IsBoolean()
  allowWhatsAppSharing?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCalls?: boolean;

  @IsOptional()
  @IsBoolean()
  allowMessages?: boolean;

  @IsOptional()
  @IsBoolean()
  allowLocationRequests?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  maxShareMinutes?: number;

  @IsOptional()
  @IsBoolean()
  showOnlineStatus?: boolean;

  @IsOptional()
  @IsBoolean()
  showLastSeen?: boolean;

  @IsOptional()
  @IsBoolean()
  showProfileVideo?: boolean;

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

class UpdateDiscoveryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredGender?: Gender[];

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(99)
  minAge?: number;

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(99)
  maxAge?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxDistanceKm?: number;

  @IsOptional()
  @IsString()
  relationshipGoal?: RelationshipGoal;

  @IsOptional()
  @IsBoolean()
  onlyVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnlineFirst?: boolean;
}

class WhatsappDto {
  @IsString()
  @MaxLength(32)
  whatsapp!: string;
}

@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('me')
  settings(@CurrentUser() user: AuthUser) {
    return this.privacy.settings(user.id);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePrivacyDto) {
    return this.privacy.update(user.id, dto);
  }

  @Get('discovery-preference')
  discovery(@CurrentUser() user: AuthUser) {
    return this.privacy.discoveryPreference(user.id);
  }

  @Patch('discovery-preference')
  async updateDiscovery(@CurrentUser() user: AuthUser, @Body() dto: UpdateDiscoveryDto) {
    return this.privacy.updateDiscoveryPreference(user.id, dto);
  }

  /** The owner's WhatsApp number. Stored encrypted; never returned in clear. */
  @Post('me/whatsapp')
  @HttpCode(HttpStatus.OK)
  async setWhatsapp(@CurrentUser() user: AuthUser, @Body() dto: WhatsappDto) {
    return this.privacy.setWhatsappNumber(user.id, dto.whatsapp);
  }
}
