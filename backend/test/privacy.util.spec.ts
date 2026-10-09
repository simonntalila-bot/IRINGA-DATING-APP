import {
  buildApproximateLocationView,
  containsCoordinateLikeKeys,
  type OwnerPrivacySettings,
} from '../src/common/geo/privacy.util';

const area = { name: 'Kihesa', kind: 'AREA' };

const ownerVisible: OwnerPrivacySettings = {
  locationVisibility: 'APPROXIMATE_AREA',
  shareAreaWithMatches: false,
};

const ownerSharing: OwnerPrivacySettings = {
  locationVisibility: 'MATCHES_GENERAL_AREA',
  shareAreaWithMatches: true,
};

const ownerHidden: OwnerPrivacySettings = {
  locationVisibility: 'HIDDEN',
  shareAreaWithMatches: false,
};

describe('buildApproximateLocationView - privacy rules', () => {
  it('never returns coordinates', () => {
    const view = buildApproximateLocationView(ownerSharing, area, 2.4, {
      isMatch: true,
      isBlockedEitherWay: false,
    });

    expect(containsCoordinateLikeKeys(view)).toEqual([]);
    expect(view.exactLocationShared).toBe(false);
  });

  it('shows only the area name to a non-match', () => {
    const view = buildApproximateLocationView(ownerSharing, area, 2.4, {
      isMatch: false,
      isBlockedEitherWay: false,
    });

    expect(view.areaName).toBe('Kihesa');
    expect(view.distanceKm).toBeNull();
    expect(view.distanceText).toBe('In the same area');
  });

  it('shows a rounded distance to a match when the owner opted in', () => {
    const view = buildApproximateLocationView(ownerSharing, area, 2.44, {
      isMatch: true,
      isBlockedEitherWay: false,
    });

    expect(view.distanceKm).toBe(2.4);
    expect(view.distanceText).toBe('~2 km away');
  });

  it('hides the distance when the owner did not opt in, even for a match', () => {
    const view = buildApproximateLocationView(ownerVisible, area, 2.4, {
      isMatch: true,
      isBlockedEitherWay: false,
    });

    expect(view.areaName).toBe('Kihesa');
    expect(view.distanceKm).toBeNull();
  });

  it('reveals nothing when the owner chose HIDDEN', () => {
    const view = buildApproximateLocationView(ownerHidden, area, 2.4, {
      isMatch: true,
      isBlockedEitherWay: false,
    });

    expect(view.areaName).toBeNull();
    expect(view.distanceKm).toBeNull();
    expect(view.distanceText).toBe('Distance unavailable');
  });

  it('reveals nothing when either user blocked the other', () => {
    const view = buildApproximateLocationView(ownerSharing, area, 0.1, {
      isMatch: true,
      isBlockedEitherWay: true,
    });

    expect(view.areaName).toBeNull();
    expect(view.distanceKm).toBeNull();
    expect(view.distanceLabel).toBe('UNKNOWN');
  });

  it('does not leak a location through a moderator view either', () => {
    const view = buildApproximateLocationView(ownerHidden, area, 0.5, {
      isMatch: false,
      isBlockedEitherWay: false,
      isModerator: true,
    });
    expect(view.areaName).toBeNull();
  });

  it('handles a missing area node', () => {
    const view = buildApproximateLocationView(ownerVisible, null, null, {
      isMatch: false,
      isBlockedEitherWay: false,
    });
    expect(view.areaName).toBeNull();
    expect(view.areaKind).toBeNull();
  });
});

describe('containsCoordinateLikeKeys', () => {
  it('detects coordinate keys anywhere in a payload', () => {
    const payload = {
      user: { id: '1', location: { latitude: -7.7, longitude: 35.2 } },
      photos: [{ mediaId: 'x', lat: 1 }],
    };
    expect(containsCoordinateLikeKeys(payload).sort()).toEqual(['lat', 'latitude', 'longitude']);
  });

  it('passes a clean payload', () => {
    expect(containsCoordinateLikeKeys({ id: '1', areaName: 'Kihesa', distanceText: '~2 km away' })).toEqual([]);
  });
});
