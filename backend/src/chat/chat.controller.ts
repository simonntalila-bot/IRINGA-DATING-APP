import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { MessageKind } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';

class SendMessageDto {
  @IsUUID()
  conversationId!: string;

  @IsOptional()
  @IsIn(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE'])
  kind?: MessageKind;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  attachmentMediaIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  durationSec?: number;
}

class MessageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  before?: string;
}

class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

class ReactionDto {
  @IsString()
  @MaxLength(16)
  emoji!: string;

  @IsOptional()
  @IsBoolean()
  remove?: boolean;
}

class PreferencesDto {
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

class SearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.chat.conversations(user.id);
  }

  @Get('conversations/:conversationId/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: MessageQueryDto,
  ) {
    return this.chat.messages(user.id, conversationId, { limit: query.limit, before: query.before });
  }

  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  send(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return this.chat.send({
      conversationId: dto.conversationId,
      senderId: user.id,
      kind: dto.kind ?? 'TEXT',
      body: dto.body,
      clientId: dto.clientId,
      replyToId: dto.replyToId,
      attachmentMediaIds: dto.attachmentMediaIds,
      durationSec: dto.durationSec,
    });
  }

  @Patch('messages/:messageId')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chat.edit(user.id, messageId, dto.body);
  }

  @Delete('messages/:messageId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('forEveryone') forEveryone?: string,
  ) {
    return this.chat.remove(user.id, messageId, forEveryone === 'true');
  }

  @Post('messages/:messageId/reactions')
  @HttpCode(HttpStatus.OK)
  react(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: ReactionDto) {
    return this.chat.react(user.id, messageId, dto.emoji, dto.remove === true);
  }

  @Post('conversations/:conversationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.chat.markRead(user.id, conversationId);
  }

  @Post('conversations/:conversationId/preferences')
  @HttpCode(HttpStatus.OK)
  preferences(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: PreferencesDto,
  ) {
    return this.chat.updatePreferences(user.id, conversationId, dto);
  }

  @Get('conversations/:conversationId/search')
  search(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: SearchQueryDto,
  ) {
    return this.chat.search(user.id, conversationId, query.q);
  }
}
