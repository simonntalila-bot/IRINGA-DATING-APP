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
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { VideoStatus } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { VideosService } from './videos.service';

class PurchaseVideoDto {
  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}

class CatalogQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

class CreateVideoDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  categorySlug!: string;

  @IsString()
  videoKey!: string;

  @IsOptional()
  @IsString()
  thumbnailKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

class UpdateVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  @IsOptional()
  @IsIn(Object.values(VideoStatus))
  status?: VideoStatus;

  @IsOptional()
  @IsString()
  moderationNote?: string;
}

@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get('categories')
  categories() {
    return this.videos.categories();
  }

  @Get()
  catalog(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) {
    return this.videos.catalog(user.id, query);
  }

  @Get(':id/play')
  play(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.videos.playbackUrl(user.id, id);
  }

  @Post(':id/purchase')
  @HttpCode(HttpStatus.OK)
  purchase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseVideoDto) {
    return this.videos.purchase(user.id, id, dto.idempotencyKey);
  }
}

@Controller('admin/videos')
export class AdminVideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  async list() {
    return this.videos.adminList();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVideoDto) {
    return this.videos.adminCreate(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVideoDto) {
    return this.videos.adminUpdate(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.videos.adminUpdate(id, { status: VideoStatus.PUBLISHED });
  }

  @Post(':id/ban')
  @HttpCode(HttpStatus.OK)
  async ban(@Param('id', ParseUUIDPipe) id: string, @Body() body: { note: string }) {
    await this.videos.ban(id, body.note);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.videos.adminDelete(id);
    return { ok: true };
  }

  @Get('stats/revenue')
  stats() {
    return this.videos.adminStats();
  }
}
