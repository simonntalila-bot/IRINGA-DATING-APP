import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import type { MediaType } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';

class UploadIntentDto {
  @IsIn(['IMAGE', 'VIDEO', 'AUDIO'])
  type!: MediaType;

  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationSec?: number;
}

class CompleteUploadDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12000)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12000)
  height?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sizeBytes?: number;
}

@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly storage: StorageService,
  ) {}

  @Post('upload-intent')
  @HttpCode(200)
  createIntent(@CurrentUser() user: AuthUser, @Body() dto: UploadIntentDto) {
    return this.media.createUploadIntent(user.id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteUploadDto) {
    return this.media.completeUpload(user.id, id, dto);
  }

  @Get(':id/url')
  getUrl(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.getSignedUrl(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.media.deleteOwned(user.id, id);
  }

  // --- Local development driver ------------------------------------------
  // Only used when R2 is not configured. R2 traffic never passes through here.

  @Put('local-upload/:storageKey')
  @HttpCode(204)
  async localUpload(
    @CurrentUser() user: AuthUser,
    @Param('storageKey') storageKey: string,
    @Req() req: Request,
  ): Promise<void> {
    const body = await readRawBody(req);
    const mimeType = req.headers['content-type'];
    await this.media.putLocal(user.id, storageKey, body, typeof mimeType === 'string' ? mimeType : undefined);
  }

  @Get('local-file/:storageKey')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  localFile(
    @Param('storageKey') storageKey: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    if (!this.storage.verifyLocalToken(storageKey, token)) {
      throw new UnauthorizedException('Invalid or expired media link');
    }
    const buffer = this.storage.readLocalObject(storageKey);
    res.setHeader('Cache-Control', 'private, max-age=600');
    return new StreamableFile(buffer);
  }
}

async function readRawBody(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolvePromise, rejectPromise) => {
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 200 * 1024 * 1024) {
        rejectPromise(new BadRequestException('File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', rejectPromise);
  });
}
