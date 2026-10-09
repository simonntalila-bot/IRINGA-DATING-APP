import {
  boundingBoxAround,
  describeDistance,
  extractPolygonRings,
  haversineKm,
  isInsideAnyPolygon,
  isInsidePolygon,
  isInsideRadius,
  isValidLatLng,
} from '../src/common/geo/geo.util';

const IRINGA_TOWN = { latitude: -7.7669, longitude: 35.2313 };

describe('haversineKm', () => {
  it('returns zero for the same point', () => {
    expect(haversineKm(IRINGA_TOWN, IRINGA_TOWN)).toBe(0);
  });

  it('matches a known reference distance', () => {
    // London -> Paris is ~343 km.
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    const distance = haversineKm(london, paris);
    expect(distance).toBeGreaterThan(340);
    expect(distance).toBeLessThan(350);
  });

  it('is symmetric', () => {
    const other = { latitude: -6.8, longitude: 35.2 };
    expect(haversineKm(IRINGA_TOWN, other)).toBeCloseTo(haversineKm(other, IRINGA_TOWN), 9);
  });

  it('gives a plausible distance between two Iringa neighbourhoods (~5 km apart)', () => {
    const north = { latitude: -7.72, longitude: 35.23 };
    expect(haversineKm(IRINGA_TOWN, north)).toBeGreaterThan(4);
    expect(haversineKm(IRINGA_TOWN, north)).toBeLessThan(7);
  });
});

describe('isValidLatLng', () => {
  it('rejects impossible coordinates', () => {
    expect(isValidLatLng({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidLatLng({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidLatLng({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng({ latitude: 'a' as unknown as number, longitude: 0 })).toBe(false);
  });

  it('accepts valid coordinates', () => {
    expect(isValidLatLng(IRINGA_TOWN)).toBe(true);
  });
});

describe('polygon containment', () => {
  // Simple square around Iringa town centre, GeoJSON order [lng, lat].
  const square: [number, number][] = [
    [35.2, -7.8],
    [35.3, -7.8],
    [35.3, -7.7],
    [35.2, -7.7],
    [35.2, -7.8],
  ];

  it('detects a point inside the polygon', () => {
    expect(isInsidePolygon(IRINGA_TOWN, square)).toBe(true);
  });

  it('detects a point outside the polygon', () => {
    expect(isInsidePolygon({ latitude: -6.8, longitude: 35.2 }, square)).toBe(false);
  });

  it('returns false for a degenerate ring', () => {
    expect(isInsidePolygon(IRINGA_TOWN, [[35.2, -7.8]])).toBe(false);
  });

  it('reads a GeoJSON Polygon and MultiPolygon', () => {
    expect(isInsideAnyPolygon(IRINGA_TOWN, { type: 'Polygon', coordinates: [square] })).toBe(true);
    expect(
      isInsideAnyPolygon(IRINGA_TOWN, {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [0, 0],
            ],
          ],
          [square],
        ],
      }),
    ).toBe(true);
  });

  it('ignores unknown geojson shapes', () => {
    expect(extractPolygonRings({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
    expect(extractPolygonRings('nope')).toEqual([]);
  });
});

describe('isInsideRadius', () => {
  const fence = { latitude: -7.7669, longitude: 35.2313 };

  it('accepts a point inside the radius', () => {
    expect(isInsideRadius({ latitude: -7.768, longitude: 35.2313 }, fence, 300)).toBe(true);
  });

  it('rejects a point outside the radius', () => {
    expect(isInsideRadius({ latitude: -7.8, longitude: 35.2313 }, fence, 300)).toBe(false);
  });

  it('treats a missing radius as a hit on the centre point', () => {
    expect(isInsideRadius(fence, fence, null)).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(isInsideRadius({ latitude: 999, longitude: 0 }, fence, 100)).toBe(false);
  });
});

describe('boundingBoxAround', () => {
  it('contains the centre point and widens with radius', () => {
    const small = boundingBoxAround(IRINGA_TOWN, 1);
    const large = boundingBoxAround(IRINGA_TOWN, 50);

    expect(small.minLat).toBeLessThan(IRINGA_TOWN.latitude);
    expect(small.maxLng).toBeGreaterThan(IRINGA_TOWN.longitude);
    expect(large.minLat).toBeLessThan(small.minLat);
    expect(large.maxLat).toBeGreaterThan(small.maxLat);
    expect(large.minLng).toBeLessThan(small.minLng);
  });
});

describe('describeDistance', () => {
  it('labels nearby, close, in-area and unknown', () => {
    expect(describeDistance(0.4).label).toBe('NEARBY');
    expect(describeDistance(0.4).text).toBe('Nearby');
    expect(describeDistance(4.2).label).toBe('CLOSE');
    expect(describeDistance(4.2).text).toBe('~4 km away');
    expect(describeDistance(25).label).toBe('IN_AREA');
    expect(describeDistance(null).label).toBe('UNKNOWN');
  });

  it('never reveals more precision than one decimal', () => {
    expect(describeDistance(2.449).km).toBe(2.4);
  });

  it('collapses long distances into a vague label', () => {
    expect(describeDistance(180).text).toBe('In the same region');
  });
});
