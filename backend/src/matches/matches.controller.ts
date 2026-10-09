import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { MatchesService } from './matches.service';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.matches.list(user.id);
  }

  @Get(':matchId')
  get(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.matches.get(user.id, matchId);
  }

  @Post(':matchId/unmatch')
  @HttpCode(HttpStatus.OK)
  async unmatch(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    await this.matches.unmatch(user.id, matchId);
    return { ok: true };
  }

  @Post('conversations/:conversationId/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
    await this.matches.markConversationRead(user.id, conversationId);
    return { ok: true };
  }
}
