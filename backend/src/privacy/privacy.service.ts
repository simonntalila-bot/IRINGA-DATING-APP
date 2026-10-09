import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LocationVisibility, type Gender, type RelationshipGoal } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EncryptionService, normalisePhone } from '../common/crypto/encryption.service';
import { UsersService } from '../users/users.service';

/**
 * The consent layer.
 *
 * Everything that could expose a person's contact details, phone number,
 * presence or location passes through here first. Two independent things must
 * both be true before anything is disclosed:
 *
 *   1. the VIEWER has the required entitlement (a successful payment), and
 *   2. the OWNER has explicitly opted in.
 *
 * A payment never overrides owner consent - rule 34 of the specification.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly encryption: EncryptionService,
  ) {}

  async settings(userId: string) {
    const existing = await this.prisma.userPrivacySettings.findUnique({ where: { userId } });
    if (existing) return existing;

    return this.prisma.userPrivacySettings.create({ data: { userId } });
  }

  async locationSettings(userId: string) {
    return this.settings(userId);
  }

  async update(
    userId: string,
    patch: Partial<{
      showMyProfile: boolean;
      showApproximateArea: boolean;
      allowContactSharing: boolean;
      allowWhatsAppSharing: boolean;
      allowCalls: boolean;
      allowMessages: boolean;
      allowLocationRequests: boolean;
      maxShareMinutes: number;
      showOnlineStatus: boolean;
      showLastSeen: boolean;
      showProfileVideo: boolean;
      locationVisibility: LocationVisibility;
      shareAreaWithMatches: boolean;
      allowAreaActivityAlerts: boolean;
      allowPlaceAlerts: boolean;
      discoveryRadiusKm: number;
    }>,
  ) {
    if (patch.maxShareMinutes != null && (patch.maxShareMinutes < 5 || patch.maxShareMinutes > 24 * 60)) {
      throw new BadRequestException('maxShareMinutes must be between 5 and 1440');
    }
    if (patch.discoveryRadiusKm != null && (patch.discoveryRadiusKm < 1 || patch.discoveryRadiusKm > 200)) {
      throw new BadRequestException('discoveryRadiusKm must be between 1 and 200');
    }
    // WhatsApp is a stricter permission than phone sharing: it can be implied.
    if (patch.allowWhatsAppSharing === true && patch.allowContactSharing === false) {
      throw new BadRequestException('Enable contact sharing before allowing WhatsApp sharing');
    }
    if (patch.allowLocationRequests === true && patch.locationVisibility === 'HIDDEN') {
      throw new BadRequestException('Live location needs at least an approximate area to be visible');
    }

    await this.prisma.userPrivacySettings.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });

    return this.settings(userId);
  }

  /** Can the viewer see this profile at all? */
  async canViewProfile(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    const [settings, blocked] = await Promise.all([
      this.settings(targetId),
      this.users.isBlockedEitherWay(viewerId, targetId),
    ]);
    return settings.showMyProfile && !blocked;
  }

  async assertCanViewProfile(viewerId: string, targetId: string): Promise<void> {
    if (!(await this.canViewProfile(viewerId, targetId))) {
      // 404 rather than 403 so we do not confirm the profile exists.
      throw new NotFoundException('Profile not found');
    }
  }

  /** Owner consent only - no entitlement check here on purpose. */
  async ownerAllowsContact(ownerId: string): Promise<boolean> {
    const settings = await this.settings(ownerId);
    return settings.allowContactSharing;
  }

  async ownerAllowsWhatsApp(ownerId: string): Promise<boolean> {
    const settings = await this.settings(ownerId);
    return settings.allowWhatsAppSharing && settings.allowContactSharing;
  }

  async ownerAllowsCalls(ownerId: string): Promise<boolean> {
    const settings = await this.settings(ownerId);
    return settings.allowCalls && settings.allowContactSharing;
  }

  async ownerAllowsLocationRequests(ownerId: string): Promise<boolean> {
    const settings = await this.settings(ownerId);
    return settings.allowLocationRequests;
  }

  async canSeePresence(viewerId: string, ownerId: string): Promise<boolean> {
    if (viewerId === ownerId) return true;
    const settings = await this.settings(ownerId);
    return settings.showOnlineStatus;
  }

  async canSeeLastSeen(viewerId: string, ownerId: string): Promise<boolean> {
    if (viewerId === ownerId) return true;
    const settings = await this.settings(ownerId);
    return settings.showLastSeen;
  }

  async canSeeProfileVideo(viewerId: string, ownerId: string): Promise<boolean> {
    if (viewerId === ownerId) return true;
    const settings = await this.settings(ownerId);
    return settings.showProfileVideo;
  }

  // --- Discovery preferences --------------------------------------------

  async discoveryPreference(userId: string) {
    const existing = await this.prisma.discoveryPreference.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.discoveryPreference.create({ data: { userId } });
  }

  /**
   * Default discovery follows the viewer's own gender (male -> female,
   * female -> male) but is stored as data, never hard-coded in a query.
   */
  async defaultPreferredGender(gender: Gender): Promise<Gender[]> {
    switch (gender) {
      case 'MALE':
        return ['FEMALE'];
      case 'FEMALE':
        return ['MALE'];
      case 'OTHER':
      case 'UNDISCLOSED':
      default:
        return ['FEMALE', 'MALE', 'OTHER'];
    }
  }

  async updateDiscoveryPreference(
    userId: string,
    patch: Partial<{
      preferredGender: Gender[];
      minAge: number;
      maxAge: number;
      maxDistanceKm: number;
      relationshipGoal: RelationshipGoal;
      onlyVerified: boolean;
      showOnlineFirst: boolean;
    }>,
  ) {
    if (patch.minAge != null && (patch.minAge < 18 || patch.minAge > 99)) {
      throw new BadRequestException('minAge must be between 18 and 99');
    }
    if (patch.maxAge != null && (patch.maxAge < 18 || patch.maxAge > 99)) {
      throw new BadRequestException('maxAge must be between 18 and 99');
    }
    if (patch.minAge != null && patch.maxAge != null && patch.minAge > patch.maxAge) {
      throw new BadRequestException('minAge cannot be greater than maxAge');
    }
    if (patch.maxDistanceKm != null && (patch.maxDistanceKm < 1 || patch.maxDistanceKm > 200)) {
      throw new BadRequestException('maxDistanceKm must be between 1 and 200');
    }
    if (patch.preferredGender && patch.preferredGender.length === 0) {
      throw new BadRequestException('Select at least one preferred gender');
    }

    await this.prisma.discoveryPreference.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });

    return this.discoveryPreference(userId);
  }

  /** Deny a blocked pair access to anything sensitive. */
  async assertNotBlocked(viewerId: string, ownerId: string): Promise<void> {
    if (await this.users.isBlockedEitherWay(viewerId, ownerId)) {
      throw new ForbiddenException('This profile is no longer available');
    }
  }

  /**
   * Store the owner's WhatsApp number. It is encrypted before it touches the
   * database and is never returned in clear - only the EntitlementService can
   * hand it out, and only to an entitled buyer the owner allows.
   */
  async setWhatsappNumber(userId: string, number: string): Promise<{ stored: true; masked: string }> {
    const normalised = normalisePhone(number);
    await this.prisma.user.update({
      where: { id: userId },
      data: { whatsappEncrypted: this.encryption.encrypt(normalised) },
    });
    return { stored: true, masked: EncryptionService.mask(normalised) ?? '' };
  }

  async hasWhatsapp(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { whatsappEncrypted: true } });
    return !!user?.whatsappEncrypted;
  }
}
