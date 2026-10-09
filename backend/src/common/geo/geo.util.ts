/**
 * Pure geography helpers.
 *
 * Nothing in this file may import Prisma, NestJS or any npm package: it is
 * unit-tested with the plain Node test runner, and reused by discovery,
 * geofencing and the Iringa-only boundary check.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const isValidLatLng = (value: Partial<LatLng> | null | undefined): value is LatLng => {
  if (!value) return false;
  const { latitude, longitude } = value;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

/**
 * Ray-casting point-in-polygon.
 *
 * Accepts a GeoJSON-ish ring: [[lng, lat], [lng, lat], ...] (GeoJSON order,
 * longitude first) and closes the ring implicitly.
 */
export function isInsidePolygon(point: LatLng, ring: readonly (readonly [number, number])[]): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return false;

  let inside = false;
  const x = point.longitude;
  const y = point.latitude;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

/** Extracts the outer ring from a stored GeoJSON Polygon/MultiPolygon value. */
export function extractPolygonRings(geoJson: unknown): (readonly (readonly [number, number])[])[] {
  if (!geoJson || typeof geoJson !== 'object') return [];

  const obj = geoJson as {
    type?: string;
    coordinates?: unknown;
    geometry?: { type?: string; coordinates?: unknown };
  };
  const source = obj.type ? obj : obj.geometry;
  if (!source?.type || !source.coordinates) return [];

  type Ring = readonly [number, number];

  if (source.type === 'Polygon') {
    const rings = (source.coordinates as unknown[][][] | undefined) ?? [];
    const outer = rings[0];
    return Array.isArray(outer) ? [outer as unknown as Ring[]] : [];
  }

  if (source.type === 'MultiPolygon') {
    const polygons = (source.coordinates as unknown[][][][] | undefined) ?? [];
    const rings: Ring[][] = [];
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (Array.isArray(outer)) rings.push(outer as unknown as Ring[]);
    }
    return rings;
  }

  return [];
}

export const isInsideAnyPolygon = (point: LatLng, geoJson: unknown): boolean =>
  extractPolygonRings(geoJson).some((ring) => isInsidePolygon(point, ring));

/**
 * Is the point inside a circular geofence?
 * A null/zero radius means "no radius configured" and is treated as a hit,
 * because the centre point itself is then the location.
 */
export function isInsideRadius(point: LatLng, centre: LatLng, radiusMeters: number | null | undefined): boolean {
  if (!isValidLatLng(point) || !isValidLatLng(centre)) return false;
  if (radiusMeters == null || radiusMeters <= 0) return true;
  return haversineMeters(point, centre) <= radiusMeters;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Pre-filter box so we never scan far-away location nodes. */
export function boundingBoxAround(point: LatLng, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(0.05, Math.cos(toRad(point.latitude))));
  return {
    minLat: point.latitude - latDelta,
    maxLat: point.latitude + latDelta,
    minLng: point.longitude - lngDelta,
    maxLng: point.longitude + lngDelta,
  };
}

export type DistanceLabel = 'NEARBY' | 'CLOSE' | 'IN_AREA' | 'AWAY' | 'UNKNOWN';

/**
 * Human friendly, deliberately coarse distance. Never returns the raw
 * coordinates and never implies a precise position - this is what other users
 * are allowed to see.
 */
export function describeDistance(km: number | null | undefined): {
  label: DistanceLabel;
  km: number | null;
  text: string;
} {
  if (km == null || !Number.isFinite(km)) {
    return { label: 'UNKNOWN', km: null, text: 'Distance unavailable' };
  }
  const rounded = Math.round(km * 10) / 10;
  if (rounded < 1) return { label: 'NEARBY', km: rounded, text: 'Nearby' };
  if (rounded < 10) return { label: 'CLOSE', km: rounded, text: `~${Math.round(rounded)} km away` };
  if (rounded < 50) return { label: 'IN_AREA', km: rounded, text: `~${Math.round(rounded)} km away` };
  return { label: 'AWAY', km: rounded, text: 'In the same region' };
}
