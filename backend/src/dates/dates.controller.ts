import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { DatesService } from './dates.service';

class ProposeDateDto {
  @IsUUID()
  conversationId!: string;

  @IsOptional()
  @IsUUID()
  placeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  placeName?: string;

  @IsISO8601()
  scheduledFor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class RespondDto {
  @IsBoolean()
  accept!: boolean;
}

class CheckInDto {
  @IsIn(['CHECK_IN', 'CHECK_OUT'])
  type!: 'CHECK_IN' | 'CHECK_OUT';
}

class SafetyContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsUUID()
  contactUserId?: string;

  @IsOptional()
  @IsBoolean()
  notifyOnOverdue?: boolean;
}

@Controller('dates')
export class DatesController {
  constructor(private readonly dates: DatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.dates.list(user.id);
  }

  @Get('config')
  config() {
    return this.dates.configForClient();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  propose(@CurrentUser() user: AuthUser, @Body() dto: ProposeDateDto) {
    return this.dates.propose(user.id, dto);
  }

  @Patch(':planId/respond')
  respond(@CurrentUser() user: AuthUser, @Param('planId', ParseUUIDPipe) planId: string, @Body() dto: RespondDto) {
    return this.dates.respond(user.id, planId, dto.accept);
  }

  @Post(':planId/check-in')
  @HttpCode(HttpStatus.OK)
  checkIn(@CurrentUser() user: AuthUser, @Param('planId', ParseUUIDPipe) planId: string, @Body() dto: CheckInDto) {
    return this.dates.checkIn(user.id, planId, dto.type);
  }

  @Get('safety-contacts')
  safetyContacts(@CurrentUser() user: AuthUser) {
    return this.dates.safetyContacts(user.id);
  }

  @Post('safety-contacts')
  @HttpCode(HttpStatus.CREATED)
  addSafetyContact(@CurrentUser() user: AuthUser, @Body() dto: SafetyContactDto) {
    return this.dates.addSafetyContact(user.id, dto);
  }
}
