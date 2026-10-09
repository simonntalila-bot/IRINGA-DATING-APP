import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CallType } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { CallsService } from './calls.service';

class InitiateCallDto {
  @IsUUID()
  calleeId!: string;

  @IsIn(Object.values(CallType))
  type!: CallType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sdpOffer?: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

class EndCallDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}

@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** REST fallback so a client can ring without a socket connection. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  initiate(@CurrentUser() user: AuthUser, @Body() dto: InitiateCallDto) {
    return this.calls.initiate({
      callerId: user.id,
      calleeId: dto.calleeId,
      type: dto.type,
      sdpOffer: dto.sdpOffer,
      conversationId: dto.conversationId,
    });
  }

  /** "Can I call this person, and if not why?" Used to grey out the Call button. */
  @Get('permissions/:userId')
  permissions(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.calls.canCall(user.id, userId);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.calls.history(user.id);
  }

  @Get(':callId')
  get(@CurrentUser() user: AuthUser, @Param('callId', ParseUUIDPipe) callId: string) {
    return this.calls.get(user.id, callId);
  }

  @Post(':callId/end')
  @HttpCode(HttpStatus.OK)
  async end(@CurrentUser() user: AuthUser, @Param('callId', ParseUUIDPipe) callId: string, @Body() dto: EndCallDto) {
    return this.calls.end(user.id, callId, dto.reason ?? 'hangup');
  }

  /** Block during a call: stops it now and prevents future calls. */
  @Post(':callId/block')
  @HttpCode(HttpStatus.OK)
  async blockDuringCall(@CurrentUser() user: AuthUser, @Param('callId', ParseUUIDPipe) callId: string) {
    const call = await this.calls.get(user.id, callId);
    await this.calls.end(user.id, callId, 'blocked_during_call');
    await this.calls.sweep();
    return { callId, otherUserId: call.otherUserId, ok: true };
  }
}
