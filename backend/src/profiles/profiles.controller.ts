import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Gender, RelationshipGoal } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { ProfilesService } from './profiles.service';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  education?: string;

  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(230)
  heightCm?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  hobbies?: string[];

  @IsOptional()
  @IsIn(['NEVER', 'OCCASIONALLY', 'REGULARLY', 'PREFER_NOT_TO_SAY'])
  smoking?: 'NEVER' | 'OCCASIONALLY' | 'REGULARLY' | 'PREFER_NOT_TO_SAY';

  @IsOptional()
  @IsIn(['NEVER', 'OCCASIONALLY', 'REGULARLY', 'PREFER_NOT_TO_SAY'])
  drinking?: 'NEVER' | 'OCCASIONALLY' | 'REGULARLY' | 'PREFER_NOT_TO_SAY';

  @IsOptional()
  @IsIn(['YES', 'NO', 'MAYBE', 'PREFER_NOT_TO_SAY'])
  childrenPreference?: 'YES' | 'NO' | 'MAYBE' | 'PREFER_NOT_TO_SAY';

  @IsOptional()
  @IsString()
  relationshipGoal?: RelationshipGoal;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  interestedIn?: Gender[];

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
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;
}

class InterestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  @IsString({ each: true })
  slugs!: string[];
}

class PhotoDto {
  @IsString()
  mediaId!: string;
}

class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  photoIds!: string[];
}

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.profiles.me(user.id);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user.id, dto);
  }

  @Get('interests')
  catalogue() {
    return this.profiles.listInterestCatalogue();
  }

  @Put('me/interests')
  @HttpCode(HttpStatus.OK)
  async setInterests(@CurrentUser() user: AuthUser, @Body() dto: InterestsDto) {
    await this.profiles.setInterests(user.id, dto.slugs);
    return { ok: true };
  }

  @Post('me/photos')
  @HttpCode(HttpStatus.CREATED)
  addPhoto(@CurrentUser() user: AuthUser, @Body() dto: PhotoDto) {
    return this.profiles.addPhoto(user.id, dto.mediaId);
  }

  @Delete('me/photos/:photoId')
  @HttpCode(HttpStatus.OK)
  async removePhoto(@CurrentUser() user: AuthUser, @Param('photoId') photoId: string) {
    await this.profiles.removePhoto(user.id, photoId);
    return { ok: true };
  }

  @Put('me/photos/order')
  @HttpCode(HttpStatus.OK)
  async reorder(@CurrentUser() user: AuthUser, @Body() dto: ReorderDto) {
    await this.profiles.reorderPhotos(user.id, dto.photoIds);
    return { ok: true };
  }

  /** Requires authentication: profiles are never browsable anonymously. */
  @Get(':userId')
  view(@Param('userId') userId: string, @CurrentUser() viewer: AuthUser) {
    return this.profiles.publicProfile(viewer.id, userId);
  }
}
