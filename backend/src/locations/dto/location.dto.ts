import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { LocationKind, PlaceCategorySlug } from '@prisma/client';

export class DetectLocationDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  accuracyM?: number;
}

/** Sent by the client after onboarding so the server can persist + evaluate it. */
export class ReportLocationDto extends DetectLocationDto {
  @IsOptional()
  @IsIn(['gps', 'manual'])
  source?: 'gps' | 'manual';

  @IsOptional()
  @IsBoolean()
  save?: boolean;
}

export class AreaQueryDto {
  @IsOptional()
  @IsIn(Object.values(LocationKind))
  kind?: LocationKind;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(300)
  limit?: number;
}

export class PlaceQueryDto {
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsIn(Object.values(PlaceCategorySlug))
  category?: PlaceCategorySlug;

  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  radiusKm?: number;

  @IsOptional()
  @IsString()
  datingFriendly?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ManualAreaDto {
  @IsUUID()
  nodeId!: string;

  @IsOptional()
  @IsBoolean()
  save?: boolean;
}
