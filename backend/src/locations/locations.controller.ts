import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { LocationEventService } from '../geofencing/location-event.service';
import { AreaQueryDto, DetectLocationDto, ManualAreaDto, PlaceQueryDto, ReportLocationDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(
    private readonly locations: LocationsService,
    private readonly events: LocationEventService,
  ) {}

  /**
   * Public: the onboarding flow needs to know whether the device is inside the
   * served area before an account exists.
   */
  @Public()
  @Post('detect')
  @HttpCode(HttpStatus.OK)
  detect(@Body() dto: DetectLocationDto) {
    return this.locations.detect(
      { latitude: dto.latitude, longitude: dto.longitude },
      { accuracyMeters: dto.accuracyM },
    );
  }

  @Post('report')
  @HttpCode(HttpStatus.OK)
  async report(@CurrentUser() user: AuthUser, @Body() dto: ReportLocationDto) {
    return this.events.handleLocationReport(user.id, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyM: dto.accuracyM,
      source: dto.source ?? 'gps',
      save: dto.save !== false,
    });
  }

  @Post('manual-area')
  @HttpCode(HttpStatus.OK)
  async manualArea(@CurrentUser() user: AuthUser, @Body() dto: ManualAreaDto) {
    return this.events.handleManualArea(user.id, dto.nodeId, dto.save !== false);
  }

  @Public()
  @Get('areas')
  areas(@Query() query: AreaQueryDto) {
    return this.locations.listAreas({
      kind: query.kind,
      search: query.search,
      regionSlug: query.region,
      limit: query.limit,
    });
  }

  @Public()
  @Get('areas/tree')
  tree(@Query('region') region?: string) {
    return this.locations.areaTree(region ?? 'iringa');
  }

  @Public()
  @Get('place-categories')
  categories() {
    return this.locations.placeCategories();
  }

  @Public()
  @Get('places')
  places(@Query() query: PlaceQueryDto) {
    return this.locations.listPlaces({
      regionSlug: query.region,
      categorySlug: query.category,
      nodeId: query.nodeId,
      near:
        query.latitude != null && query.longitude != null
          ? { latitude: query.latitude, longitude: query.longitude }
          : undefined,
      radiusKm: query.radiusKm,
      datingFriendlyOnly: query.datingFriendly === 'true',
      search: query.search,
      limit: query.limit,
    });
  }

  @Public()
  @Get('places/:idOrSlug')
  async place(@Param('idOrSlug') idOrSlug: string) {
    const place = await this.locations.placeDetail(idOrSlug);
    if (!place || !place.isActive) {
      throw new NotFoundException('Place not found');
    }
    return {
      id: place.id,
      slug: place.slug,
      name: place.name,
      description: place.description,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      radiusM: place.radiusM,
      openingHours: place.openingHours,
      phone: place.phone,
      website: place.website,
      isDatingFriendly: place.isDatingFriendly,
      isVerified: place.isVerified,
      category: place.category,
      area: place.node,
      photos: place.photos,
    };
  }
}
