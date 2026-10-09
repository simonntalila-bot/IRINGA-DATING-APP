-- Widen emoji columns: multi-codepoint emoji (family sequences, flags) exceed
-- 16 UTF-16 units, and a corrupted byte sequence must not be stored.

ALTER TABLE "interests"        ALTER COLUMN "emoji" TYPE character varying(64);
ALTER TABLE "place_categories" ALTER COLUMN "emoji" TYPE character varying(64);
ALTER TABLE "video_categories" ALTER COLUMN "emoji" TYPE character varying(64);
