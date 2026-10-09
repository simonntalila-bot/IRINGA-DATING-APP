import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { PostsService } from './posts.service';

class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  mediaIds!: string[];
}

class CommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}

class FeedQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser, @Query() query: FeedQueryDto) {
    return this.posts.feed(user.id, query.cursor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) {
    return this.posts.create(user.id, dto);
  }

  @Post(':postId/like')
  @HttpCode(HttpStatus.OK)
  like(@CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.like(user.id, postId);
  }

  @Delete(':postId/like')
  @HttpCode(HttpStatus.OK)
  unlike(@CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.posts.unlike(user.id, postId);
  }

  @Post(':postId/comments')
  @HttpCode(HttpStatus.CREATED)
  comment(@CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: CommentDto) {
    return this.posts.comment(user.id, postId, dto.body);
  }

  @Delete(':postId')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: AuthUser, @Param('postId', ParseUUIDPipe) postId: string) {
    await this.posts.remove(user.id, postId);
    return { ok: true };
  }
}
