-- PostGIS is optional. The app uses plain haversine + optional GeoJSON polygons,
-- so the standard postgres image is enough for development.
-- If you want native spatial indexes later, switch to postgis/postgis image and run:
--   CREATE EXTENSION IF NOT EXISTS postgis;
--   ALTER TABLE "LocationArea" ADD COLUMN boundary geometry(Polygon, 4326);
--   CREATE INDEX ON "LocationArea" USING GIST (boundary);
SELECT 1;