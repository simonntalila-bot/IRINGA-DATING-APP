import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { StoryPrivacy } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { StoriesService } from './stories.service';

class CreateStoryDto {
  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  textBody?: string;

  @IsOptional()
  @IsIn(['PUBLIC', 'MATCHES_ONLY', 'HIDDEN'])
  privacy?: StoryPrivacy;
}

@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser) {
    return this.stories.feed(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(user.id, dto);
  }

  @Post(':storyId/view')
  @HttpCode(HttpStatus.OK)
  view(@CurrentUser() user: AuthUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.stories.view(user.id, storyId);
  }

  @Get(':storyId/viewers')
  viewers(@CurrentUser() user: AuthUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.stories.viewers(user.id, storyId);
  }

  @Delete(':storyId')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: AuthUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    await this.stories.delete(user.id, storyId);
    return { ok: true };
  }

  @Post('hide/:targetId')
  @HttpCode(HttpStatus.OK)
  async hide(@CurrentUser() user: AuthUser, @Param('targetId', ParseUUIDPipe) targetId: string) {
    await this.stories.hideStory(user.id, targetId);
    return { ok: true };
  }
}
