import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminRole, LocationKind, PlaceCategorySlug } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { AdminRoles } from '../common/decorators/admin-roles.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { AdminService } from './admin.service';
import { ReportsService } from '../reports/reports.service';

class CreateNodeDto {
  @IsOptional()
  @IsString()
  regionSlug?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsIn(Object.values(LocationKind))
  kind!: LocationKind;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsLatitude()
  centerLat?: number;

  @IsOptional()
  @IsLongitude()
  centerLng?: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(100000)
  radiusM?: number;

  @IsOptional()
  @IsObject()
  boundary?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

class UpdateNodeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsLatitude()
  centerLat?: number;

  @IsOptional()
  @IsLongitude()
  centerLng?: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(100000)
  radiusM?: number;

  @IsOptional()
  @IsObject()
  boundary?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

class ToggleDto {
  @IsBoolean()
  isActive!: boolean;
}

class CreatePlaceDto {
  @IsOptional()
  @IsString()
  regionSlug?: string;

  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @IsIn(Object.values(PlaceCategorySlug))
  categorySlug!: PlaceCategorySlug;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(5000)
  radiusM?: number;

  @IsOptional()
  @IsObject()
  openingHours?: Record<string, string>;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsBoolean()
  isDatingFriendly?: boolean;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsString()
  sourceNote?: string;
}

class UpdatePlaceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(5000)
  radiusM?: number;

  @IsOptional()
  @IsObject()
  openingHours?: Record<string, string>;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsBoolean()
  isDatingFriendly?: boolean;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  sourceNote?: string;
}

class ResolveReportDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  note?: string;
}

class NodeQueryDto {
  @IsOptional()
  @IsIn(Object.values(LocationKind))
  kind?: LocationKind;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  region?: string;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  // --- Regions -----------------------------------------------------------

  @Get('regions')
  regions() {
    return this.admin.listRegions();
  }

  @Patch('regions/:id/active')
  toggleRegion(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ToggleDto) {
    return this.admin.setRegionActive(admin.id, id, dto.isActive);
  }

  @Put('regions/:id/boundary')
  setBoundary(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.admin.setRegionBoundary(admin.id, id, body);
  }

  // --- Location hierarchy ------------------------------------------------

  @Get('locations')
  async listNodes(@Query() query: NodeQueryDto) {
    const region = await this.prisma.supportedRegion.findUnique({
      where: { slug: query.region ?? 'iringa' },
    });
    if (!region) return [];

    return this.prisma.locationNode.findMany({
      where: {
        regionId: region.id,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      take: 500,
      select: {
        id: true,
        name: true,
        kind: true,
        slug: true,
        parentId: true,
        centerLat: true,
        centerLng: true,
        radiusM: true,
        isActive: true,
        _count: { select: { usersHere: true, places: true } },
      },
    });
  }

  @Post('locations')
  createNode(@CurrentUser() admin: AuthUser, @Body() dto: CreateNodeDto) {
    return this.admin.createNode(admin.id, dto);
  }

  @Patch('locations/:id')
  updateNode(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNodeDto) {
    return this.admin.updateNode(admin.id, id, dto);
  }

  @Patch('locations/:id/active')
  toggleNode(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ToggleDto) {
    return this.admin.setNodeActive(admin.id, id, dto.isActive);
  }

  @Delete('locations/:id')
  async deleteNode(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.admin.deleteNode(admin.id, id);
    return { ok: true };
  }

  // --- Places ------------------------------------------------------------

  @Get('places')
  async listPlaces(@Query('search') search?: string) {
    const region = await this.prisma.supportedRegion.findFirst({ where: { isActive: true } });
    if (!region) return [];

    return this.prisma.locationPlace.findMany({
      where: {
        regionId: region.id,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        name: true,
        slug: true,
        latitude: true,
        longitude: true,
        radiusM: true,
        isActive: true,
        isVerified: true,
        isDatingFriendly: true,
        node: { select: { id: true, name: true } },
        category: { select: { slug: true, labelEn: true } },
      },
    });
  }

  @Post('places')
  createPlace(@CurrentUser() admin: AuthUser, @Body() dto: CreatePlaceDto) {
    return this.admin.createPlace(admin.id, dto);
  }

  @Patch('places/:id')
  updatePlace(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlaceDto) {
    return this.admin.updatePlace(admin.id, id, dto);
  }

  @Post('places/:id/photos')
  async addPlacePhoto(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { mediaId: string },
  ) {
    const photo = await this.prisma.placePhoto.create({
      data: { placeId: id, mediaId: body.mediaId },
      select: { id: true, mediaId: true },
    });
    await this.admin.log(admin.id, 'place.photo.add', 'LocationPlace', id, { mediaId: body.mediaId });
    return photo;
  }

  // --- Moderation --------------------------------------------------------

  @Get('reports')
  reports_(@Query('limit') limit?: string) {
    return this.reports.openReports(limit ? Number(limit) : 50);
  }

  @Post('reports/:id/resolve')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.MODERATOR)
  resolveReport(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto) {
    return this.reports.resolve(admin.id, id, dto.decision === 'approve', dto.note);
  }

  @Post('users/:id/suspend')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { reason?: string },
  ) {
    await this.reports.suspendUser(admin.id, id, dto.reason);
    return { ok: true };
  }

  @Get('logs')
  async logs(@Query('take') take?: string) {
    return this.prisma.adminLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take ?? 100), 500),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        meta: true,
        createdAt: true,
        admin: { select: { email: true, role: true } },
      },
    });
  }
}
