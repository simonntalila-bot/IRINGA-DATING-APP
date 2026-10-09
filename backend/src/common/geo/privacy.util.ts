/**
 * Location privacy - the single place that decides what one user may learn
 * about another user's position.
 *
 * Rules enforced here:
 *  - Raw latitude/longitude is NEVER part of the returned object.
 *  - An area name is only returned when the owner did not choose HIDDEN.
 *  - Distance is only returned to an active match, and only when BOTH users
 *    opted in to general-area sharing.
 *  - No distance/area at all when either user blocked the other.
 *
 * Kept dependency-free so it can be unit-tested directly.
 */

import { describeDistance, type DistanceLabel } from '../geo/geo.util';

export type ViewerVisibility = 'HIDDEN' | 'APPROXIMATE_AREA' | 'MATCHES_GENERAL_AREA';

export interface OwnerPrivacySettings {
  locationVisibility: ViewerVisibility;
  shareAreaWithMatches: boolean;
}

export interface LocationPrivacyContext {
  /** The two users are in an active match. */
  isMatch: boolean;
  /** Either user blocked the other - nothing is shared. */
  isBlockedEitherWay: boolean;
  /** Viewer is an admin/moderator viewing a report: still no coordinates. */
  isModerator?: boolean;
}

export interface ApproximateLocationView {
  areaName: string | null;
  areaKind: string | null;
  distanceKm: number | null;
  distanceLabel: DistanceLabel;
  distanceText: string;
  /** Always false. Kept as an explicit signal for client code and tests. */
  exactLocationShared: false;
}

const UNKNOWN: ApproximateLocationView = {
  areaName: null,
  areaKind: null,
  distanceKm: null,
  distanceLabel: 'UNKNOWN',
  distanceText: 'Distance unavailable',
  exactLocationShared: false,
};

export function buildApproximateLocationView(
  owner: OwnerPrivacySettings,
  ownerArea: { name: string; kind: string } | null,
  distanceKm: number | null,
  ctx: LocationPrivacyContext,
): ApproximateLocationView {
  if (ctx.isBlockedEitherWay) return UNKNOWN;

  const canSeeArea = owner.locationVisibility !== 'HIDDEN';
  const areaName = canSeeArea && ownerArea ? ownerArea.name : null;
  const areaKind = canSeeArea && ownerArea ? ownerArea.kind : null;

  // Distance requires an active match plus mutual consent. Anything else
  // degrades to "Nearby" so a user cannot triangulate a position from swipes.
  const bothOptedIn = ctx.isMatch && owner.shareAreaWithMatches;
  if (!bothOptedIn || distanceKm == null || !Number.isFinite(distanceKm)) {
    return {
      areaName,
      areaKind,
      distanceKm: null,
      distanceLabel: areaName ? 'IN_AREA' : 'UNKNOWN',
      distanceText: areaName ? 'In the same area' : 'Distance unavailable',
      exactLocationShared: false,
    };
  }

  const described = describeDistance(distanceKm);
  return {
    areaName,
    areaKind,
    distanceKm: described.km,
    distanceLabel: described.label,
    distanceText: described.text,
    exactLocationShared: false,
  };
}

/**
 * Assert-style guard used by serialisation tests: any key that can leak a
 * coordinate must not survive into a public profile payload.
 */
const FORBIDDEN_KEYS = ['latitude', 'longitude', 'lat', 'lng', 'exactLocation', 'userLocation', 'gps'];

export function containsCoordinateLikeKeys(payload: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.includes(key)) found.push(key);
        walk(value);
      }
    }
  };
  walk(payload);
  return found;
}
