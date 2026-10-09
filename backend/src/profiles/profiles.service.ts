import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Gender, RelationshipGoal } from '@prisma/client';
import { calculateAge, isValidDateOfBirth } from '../common/utils/age.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import {
  buildApproximateLocationView,
  type ApproximateLocationView,
  type OwnerPrivacySettings,
} from '../common/geo/privacy.util';
import { haversineKm } from '../common/geo/geo.util';
import { UsersService } from '../users/users.service';

export interface PublicProfile {
  userId: string;
  displayName: string;
  age: number;
  gender: Gender;
  interestedIn: Gender[];
  relationshipGoal: RelationshipGoal;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  heightCm: number | null;
  languages: string[];
  hobbies: string[];
  smoking: string;
  drinking: string;
  childrenPreference: string;
  /**
   * The client resolves each photo with GET /media/:id/url, which returns a
   * short-lived signed URL after an authorisation check. Nothing user-owned is
   * ever served from a guessable public path.
   */
  photos: Array<{ mediaId: string; position: number; isPrimary: boolean }>;
  video: { mediaId: string } | null;
  interests: Array<{ slug: string; labelEn: string; labelSw: string; emoji: string | null }>;
  verifiedPhone: boolean;
  verifiedEmail: boolean;
  selfieVerified: boolean;
  profileCompletePct: number;
  lastActiveAt: string | null;
  location: ApproximateLocationView;
  isMatch: boolean;
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly redis: RedisService,
  ) {}

  async me(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        photos: { orderBy: { position: 'asc' }, include: { media: true } },
        videos: { orderBy: { createdAt: 'desc' } },
        interestLinks: { include: { interest: true } },
        displayedAreaNode: { select: { id: true, name: true, kind: true } },
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const [verification, user] = await Promise.all([
      this.prisma.verification.findMany({ where: { userId }, select: { type: true, status: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true, emailVerifiedAt: true } }),
    ]);

    return {
      ...profile,
      age: calculateAge(profile.dateOfBirth),
      verification: {
        phone: verification.some((v) => v.type === 'PHONE' && v.status === 'APPROVED') || !!user?.phoneVerifiedAt,
        email: !!user?.emailVerifiedAt,
        selfie: verification.some((v) => v.type === 'SELFIE' && v.status === 'APPROVED'),
      },
    };
  }

  async update(
    userId: string,
    input: {
      displayName?: string;
      bio?: string;
      occupation?: string;
      education?: string;
      heightCm?: number;
      languages?: string[];
      hobbies?: string[];
      smoking?: 'NEVER' | 'OCCASIONALLY' | 'REGULARLY' | 'PREFER_NOT_TO_SAY';
      drinking?: 'NEVER' | 'OCCASIONALLY' | 'REGULARLY' | 'PREFER_NOT_TO_SAY';
      childrenPreference?: 'YES' | 'NO' | 'MAYBE' | 'PREFER_NOT_TO_SAY';
      relationshipGoal?: RelationshipGoal;
      interestedIn?: Gender[];
      minAge?: number;
      maxAge?: number;
      maxDistanceKm?: number;
      dateOfBirth?: string;
    },
  ): Promise<{ profileCompletePct: number }> {
    if (input.dateOfBirth) {
      const dob = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
      if (!isValidDateOfBirth(dob)) throw new BadRequestException('Invalid date of birth');
    }
    if (input.minAge != null && input.maxAge != null && input.minAge > input.maxAge) {
      throw new BadRequestException('minAge cannot be greater than maxAge');
    }
    if (input.maxDistanceKm != null && (input.maxDistanceKm < 1 || input.maxDistanceKm > 200)) {
      throw new BadRequestException('maxDistanceKm must be between 1 and 200');
    }

    const { dateOfBirth, ...rest } = input;
    await this.prisma.profile.update({
      where: { userId },
      data: {
        ...rest,
        ...(dateOfBirth ? { dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`) } : {}),
      },
    });

    const pct = await this.recalculateCompletion(userId);
    return { profileCompletePct: pct };
  }

  async recalculateCompletion(userId: string): Promise<number> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: { photos: { select: { id: true } }, interestLinks: { select: { interestId: true } } },
    });
    if (!profile) return 0;

    const checks = [
      !!profile.bio && profile.bio.length >= 20,
      profile.photos.length >= 1,
      profile.photos.length >= 3,
      profile.interestLinks.length >= 3,
      !!profile.occupation,
      !!profile.education,
      profile.languages.length >= 1,
      !!profile.displayedAreaNodeId,
    ];
    const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    await this.prisma.profile.update({ where: { userId }, data: { profileCompletePct: pct } });
    return pct;
  }

  async setInterests(userId: string, interestSlugs: string[]): Promise<void> {
    const interests = await this.prisma.interest.findMany({
      where: { slug: { in: interestSlugs }, isActive: true },
      select: { id: true },
    });
    if (interests.length !== interestSlugs.length) {
      throw new BadRequestException('One or more interests do not exist');
    }
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Profile not found');

    await this.prisma.$transaction([
      this.prisma.userInterest.deleteMany({ where: { userId } }),
      this.prisma.userInterest.createMany({
        data: interests.map((i) => ({ userId, interestId: i.id, profileId: profile.id })),
      }),
    ]);

    await this.recalculateCompletion(userId);
  }

  async addPhoto(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.ownerId !== userId || media.type !== 'IMAGE') {
      throw new BadRequestException('Attach a valid image that you uploaded');
    }
    const count = await this.prisma.profilePhoto.count({ where: { userId } });
    if (count >= 6) throw new BadRequestException('Maximum of 6 profile photos');

    const created = await this.prisma.profilePhoto.create({
      data: { userId, mediaId, position: count, isPrimary: count === 0 },
    });
    await this.recalculateCompletion(userId);
    return created;
  }

  async removePhoto(userId: string, photoId: string): Promise<void> {
    await this.prisma.profilePhoto.deleteMany({ where: { id: photoId, userId } });
    const remaining = await this.prisma.profilePhoto.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    // Keep exactly one primary and close the numbering gaps.
    await this.prisma.$transaction([
      ...remaining.map((photo, index) =>
        this.prisma.profilePhoto.update({
          where: { id: photo.id },
          data: { position: index, isPrimary: index === 0 },
        }),
      ),
    ]);
    await this.recalculateCompletion(userId);
  }

  async reorderPhotos(userId: string, photoIds: string[]): Promise<void> {
    const owned = await this.prisma.profilePhoto.findMany({ where: { userId }, select: { id: true } });
    const ownedIds = new Set(owned.map((p) => p.id));
    if (photoIds.length !== ownedIds.size || !photoIds.every((id) => ownedIds.has(id))) {
      throw new BadRequestException('photoIds must contain every photo you own, exactly once');
    }

    await this.prisma.$transaction(
      photoIds.map((id, index) =>
        this.prisma.profilePhoto.update({
          where: { id },
          data: { position: index, isPrimary: index === 0 },
        }),
      ),
    );
  }

  /**
   * Public profile with privacy applied.
   *
   * Note what is NOT here: latitude, longitude, phone, email, lastSeenAt of
   * another user in raw form, block state and internal ids other than the user
   * id. The only coordinates in the payload are those of a dating PLACE.
   */
  async publicProfile(viewerId: string, targetUserId: string): Promise<PublicProfile> {
    await this.users.assertCanInteract(viewerId, targetUserId);

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        profile: {
          include: {
            photos: { orderBy: { position: 'asc' }, select: { mediaId: true, position: true, isPrimary: true } },
            videos: { orderBy: { createdAt: 'desc' }, take: 1, select: { mediaId: true } },
            interestLinks: { include: { interest: true } },
            displayedAreaNode: { select: { name: true, kind: true } },
          },
        },
      },
    });

    if (!target?.profile) throw new NotFoundException('Profile not found');

    const [prefs, viewerPrefs, viewerLocation, isMatch] = await Promise.all([
      this.users.privacySettings(target.id),
      this.users.privacySettings(viewerId),
      this.prisma.userLocation.findUnique({
        where: { userId: viewerId },
        select: { latitude: true, longitude: true },
      }),
      this.prisma.match.count({
        where: {
          state: 'ACTIVE',
          participants: { some: { userId: viewerId } },
          OR: [{ userAId: target.id }, { userBId: target.id }],
        },
      }),
    ]);

    const distanceKm =
      viewerLocation && target.profile.displayedAreaNode ? await this.areaDistance(viewerLocation, target.id) : null;

    const ownerSettings: OwnerPrivacySettings = {
      locationVisibility: prefs.locationVisibility,
      shareAreaWithMatches: prefs.shareAreaWithMatches,
    };

    // Distance is only meaningful when the viewer opted in too.
    const location = buildApproximateLocationView(
      ownerSettings,
      target.profile.displayedAreaNode
        ? { name: target.profile.displayedAreaNode.name, kind: target.profile.displayedAreaNode.kind }
        : null,
      viewerPrefs.shareAreaWithMatches ? distanceKm : null,
      { isMatch: isMatch > 0, isBlockedEitherWay: false },
    );

    const verifications = await this.prisma.verification.findMany({
      where: { userId: target.id, status: 'APPROVED' },
      select: { type: true },
    });

    const profile = target.profile;

    return {
      userId: target.id,
      displayName: profile.displayName,
      age: calculateAge(profile.dateOfBirth),
      gender: profile.gender,
      interestedIn: profile.interestedIn,
      relationshipGoal: profile.relationshipGoal,
      bio: profile.bio,
      occupation: profile.occupation,
      education: profile.education,
      heightCm: profile.heightCm,
      languages: profile.languages,
      hobbies: profile.hobbies,
      smoking: profile.smoking,
      drinking: profile.drinking,
      childrenPreference: profile.childrenPreference,
      photos: profile.photos.map((p) => ({
        mediaId: p.mediaId,
        position: p.position,
        isPrimary: p.isPrimary,
      })),
      video: profile.videos[0] ? { mediaId: profile.videos[0].mediaId } : null,
      interests: profile.interestLinks.map((link) => ({
        slug: link.interest.slug,
        labelEn: link.interest.labelEn,
        labelSw: link.interest.labelSw,
        emoji: link.interest.emoji,
      })),
      verifiedPhone: !!target.phoneVerifiedAt || verifications.some((v) => v.type === 'PHONE'),
      verifiedEmail: !!target.emailVerifiedAt,
      selfieVerified: verifications.some((v) => v.type === 'SELFIE'),
      profileCompletePct: profile.profileCompletePct,
      lastActiveAt: profile.lastActiveAt ? relativeTime(profile.lastActiveAt) : null,
      location,
      isMatch: isMatch > 0,
    };
  }

  /**
   * Distance between two users is computed server side and then immediately
   * coarsened. The raw coordinates never leave this method.
   */
  private async areaDistance(
    viewerLocation: { latitude: number; longitude: number },
    targetId: string,
  ): Promise<number | null> {
    const targetLocation = await this.prisma.userLocation.findUnique({
      where: { userId: targetId },
      select: { latitude: true, longitude: true },
    });
    if (!targetLocation) return null;
    return haversineKm(viewerLocation, targetLocation);
  }

  async listInterestCatalogue() {
    const cached = await this.redis.get('catalogue:interests');
    if (cached) return JSON.parse(cached) as unknown;

    const rows = await this.prisma.interest.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { labelEn: 'asc' }],
      select: { slug: true, labelEn: true, labelSw: true, emoji: true, category: true },
    });
    await this.redis.set('catalogue:interests', JSON.stringify(rows), 600);
    return rows;
  }
}

export const relativeTime = (date: Date): string => {
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
};
