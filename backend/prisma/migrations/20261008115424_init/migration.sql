-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "RelationshipGoal" AS ENUM ('MARRIAGE', 'LONG_TERM', 'SERIOUS_DATING', 'SHORT_TERM', 'FRIENDSHIP');

-- CreateEnum
CREATE TYPE "SmokingPreference" AS ENUM ('NEVER', 'OCCASIONALLY', 'REGULARLY', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "DrinkingPreference" AS ENUM ('NEVER', 'OCCASIONALLY', 'REGULARLY', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "ChildrenPreference" AS ENUM ('YES', 'NO', 'MAYBE', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "SwipeType" AS ENUM ('PASS', 'LIKE', 'SUPER_LIKE');

-- CreateEnum
CREATE TYPE "MatchState" AS ENUM ('ACTIVE', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO');

-- CreateEnum
CREATE TYPE "LocationVisibility" AS ENUM ('HIDDEN', 'APPROXIMATE_AREA', 'MATCHES_GENERAL_AREA');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('DISTRICT', 'MUNICIPALITY', 'WARD', 'AREA', 'VILLAGE', 'STREET');

-- CreateEnum
CREATE TYPE "PlaceCategorySlug" AS ENUM ('DATING_SPOT', 'RESTAURANT', 'CAFE', 'ENTERTAINMENT', 'HOTEL', 'EVENT', 'OUTDOOR', 'FITNESS', 'CINEMA', 'SHOPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_LIKE', 'NEW_SUPER_LIKE', 'NEW_MATCH', 'NEW_MESSAGE', 'VOICE_MESSAGE', 'STORY_REACTION', 'PROFILE_VIEW', 'DATE_INVITATION', 'DATE_REMINDER', 'DATE_SAFETY_REMINDER', 'AREA_ACTIVITY_MATCH', 'SUBSCRIPTION', 'BOOST_STARTED', 'BOOST_ENDED', 'SECURITY_ALERT', 'MODERATION');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('FAKE_PROFILE', 'SCAM', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE_CONTENT', 'UNDERAGE', 'THREAT', 'OFF_PLATFORM_SOLICITATION', 'NON_CONSENSUAL_CONTENT', 'BLACKMAIL_EXTORTION', 'PROHIBITED_SEXUAL_SERVICES', 'TRAFFICKING_OR_COERCION', 'UNDERAGE_SEXUAL_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('PHONE', 'EMAIL', 'PHOTO', 'SELFIE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PREMIUM', 'VIP');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CONTACT_UNLOCK', 'VIDEO_PURCHASE', 'PREMIUM_SUBSCRIPTION', 'BOOST', 'OTHER_PREMIUM_FEATURE');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('CONTACT_UNLOCK', 'PREMIUM_VIDEO', 'SUBSCRIPTION', 'BOOST');

-- CreateEnum
CREATE TYPE "EntitlementType" AS ENUM ('CONTACT_UNLOCK', 'VIDEO_PURCHASE', 'PREMIUM_SUBSCRIPTION', 'BOOST', 'FEATURE_FLAG', 'LOCATION_SHARE');

-- CreateEnum
CREATE TYPE "ContactUnlockStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'BANNED');

-- CreateEnum
CREATE TYPE "LocationShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VideoPurchaseStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'MISSED', 'ENDED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT');

-- CreateEnum
CREATE TYPE "StoryPrivacy" AS ENUM ('PUBLIC', 'MATCHES_ONLY', 'HIDDEN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_hash" VARCHAR(64) NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "whatsapp_encrypted" TEXT,
    "email" VARCHAR(255),
    "password_hash" VARCHAR(120) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "role" VARCHAR(32) NOT NULL DEFAULT 'user',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "phone_verified_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "age_confirmed_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(120) NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" VARCHAR(400),
    "ip" VARCHAR(64),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(120),
    "device_name" VARCHAR(120),
    "platform" VARCHAR(32),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "target" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "code_hash" VARCHAR(120) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "interested_in" "Gender"[],
    "relationship_goal" "RelationshipGoal" NOT NULL,
    "bio" VARCHAR(1000),
    "occupation" VARCHAR(120),
    "education" VARCHAR(160),
    "height_cm" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hobbies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "smoking" "SmokingPreference" NOT NULL DEFAULT 'PREFER_NOT_TO_SAY',
    "drinking" "DrinkingPreference" NOT NULL DEFAULT 'PREFER_NOT_TO_SAY',
    "children_preference" "ChildrenPreference" NOT NULL DEFAULT 'PREFER_NOT_TO_SAY',
    "min_age" INTEGER NOT NULL DEFAULT 18,
    "max_age" INTEGER NOT NULL DEFAULT 99,
    "max_distance_km" INTEGER NOT NULL DEFAULT 50,
    "displayed_area_node_id" UUID,
    "last_active_at" TIMESTAMP(3),
    "profile_complete_pct" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_videos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "caption" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interests" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "label_en" VARCHAR(80) NOT NULL,
    "label_sw" VARCHAR(80) NOT NULL,
    "emoji" VARCHAR(16),
    "category" VARCHAR(60),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_interests" (
    "user_id" UUID NOT NULL,
    "interest_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("user_id","interest_id")
);

-- CreateTable
CREATE TABLE "supported_regions" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "center_lat" DOUBLE PRECISION NOT NULL,
    "center_lng" DOUBLE PRECISION NOT NULL,
    "boundary" JSONB,
    "default_radius_km" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supported_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_nodes" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "LocationKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" VARCHAR(500),
    "center_lat" DOUBLE PRECISION,
    "center_lng" DOUBLE PRECISION,
    "radius_m" INTEGER,
    "boundary" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_categories" (
    "id" UUID NOT NULL,
    "slug" "PlaceCategorySlug" NOT NULL,
    "label_en" VARCHAR(80) NOT NULL,
    "label_sw" VARCHAR(80) NOT NULL,
    "emoji" VARCHAR(16),
    "is_dating_spot" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "place_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_places" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "node_id" UUID,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" VARCHAR(1000),
    "address" VARCHAR(255),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL DEFAULT 150,
    "opening_hours" JSONB,
    "phone" VARCHAR(40),
    "website" VARCHAR(255),
    "is_dating_friendly" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "source_note" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_photos" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "node_id" UUID,
    "place_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL,
    "notify_matches_only" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_locations" (
    "user_id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy_m" INTEGER,
    "area_node_id" UUID,
    "outside_supported_region" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(20) NOT NULL DEFAULT 'gps',
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_privacy_settings" (
    "user_id" UUID NOT NULL,
    "show_my_profile" BOOLEAN NOT NULL DEFAULT true,
    "show_approximate_area" BOOLEAN NOT NULL DEFAULT true,
    "allow_contact_sharing" BOOLEAN NOT NULL DEFAULT false,
    "allow_whatsapp_sharing" BOOLEAN NOT NULL DEFAULT false,
    "allow_calls" BOOLEAN NOT NULL DEFAULT false,
    "allow_messages" BOOLEAN NOT NULL DEFAULT true,
    "allow_location_requests" BOOLEAN NOT NULL DEFAULT false,
    "max_share_minutes" INTEGER NOT NULL DEFAULT 30,
    "show_online_status" BOOLEAN NOT NULL DEFAULT true,
    "show_last_seen" BOOLEAN NOT NULL DEFAULT true,
    "show_profile_video" BOOLEAN NOT NULL DEFAULT true,
    "location_visibility" "LocationVisibility" NOT NULL DEFAULT 'APPROXIMATE_AREA',
    "share_area_with_matches" BOOLEAN NOT NULL DEFAULT false,
    "allow_area_activity_alerts" BOOLEAN NOT NULL DEFAULT false,
    "allow_place_alerts" BOOLEAN NOT NULL DEFAULT false,
    "discovery_radius_km" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "discovery_preferences" (
    "user_id" UUID NOT NULL,
    "preferred_gender" "Gender"[] DEFAULT ARRAY['FEMALE']::"Gender"[],
    "min_age" INTEGER NOT NULL DEFAULT 18,
    "max_age" INTEGER NOT NULL DEFAULT 60,
    "max_distance_km" INTEGER NOT NULL DEFAULT 50,
    "relationship_goal" "RelationshipGoal",
    "only_verified" BOOLEAN NOT NULL DEFAULT false,
    "show_online_first" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_location_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "geofence_id" UUID,
    "node_id" UUID,
    "area_name" VARCHAR(120),
    "kind" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_location_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swipes" (
    "id" UUID NOT NULL,
    "swiper_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "type" "SwipeType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "initiated_by" UUID NOT NULL,
    "state" "MatchState" NOT NULL DEFAULT 'ACTIVE',
    "compatibility_score" INTEGER NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("match_id","user_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "conversation_read_states" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_read_states_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "reply_to_id" UUID,
    "client_id" VARCHAR(64),
    "duration_sec" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id","user_id","emoji")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "bucket" VARCHAR(80) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_sec" INTEGER,
    "checksum" VARCHAR(128),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ready',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_moderation" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "reporter_id" UUID,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "media_moderation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(400) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_hides" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_hides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_user_id" UUID,
    "reported_post_id" UUID,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(1000),
    "evidence" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "public_id" VARCHAR(40) NOT NULL,
    "reviewed_by" UUID,
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_id" UUID,
    "text_body" VARCHAR(500),
    "privacy" "StoryPrivacy" NOT NULL DEFAULT 'PUBLIC',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_views" (
    "story_id" UUID NOT NULL,
    "viewer_id" UUID NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_views_pkey" PRIMARY KEY ("story_id","viewer_id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "caption" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("post_id","user_id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "date_plans" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "place_id" UUID,
    "place_name" VARCHAR(160) NOT NULL,
    "place_lat" DOUBLE PRECISION,
    "place_lng" DOUBLE PRECISION,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "date_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "date_plan_participants" (
    "date_plan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "date_plan_participants_pkey" PRIMARY KEY ("date_plan_id","user_id")
);

-- CreateTable
CREATE TABLE "date_check_ins" (
    "id" UUID NOT NULL,
    "date_plan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "date_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "contact_user_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notify_on_overdue" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" VARCHAR(40),
    "provider_ref" VARCHAR(160),
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "PaymentType" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_ref" VARCHAR(160),
    "provider_tx_id" VARCHAR(160),
    "idempotency_key" VARCHAR(80) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" VARCHAR(255),
    "metadata" JSONB,
    "paid_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_items" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "product_type" "ProductType" NOT NULL,
    "product_id" VARCHAR(64),
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscription_id" UUID,
    "boost_id" UUID,

    CONSTRAINT "payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boosts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "profile_visits" INTEGER NOT NULL DEFAULT 0,
    "likes_received" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_unlocks" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "profile_owner_id" UUID NOT NULL,
    "payment_item_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "status" "ContactUnlockStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone_unlocked" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "contact_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "label_en" VARCHAR(80) NOT NULL,
    "label_sw" VARCHAR(80) NOT NULL,
    "emoji" VARCHAR(16),
    "is_adult" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "video_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_videos" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "category_id" UUID NOT NULL,
    "thumbnail_key" VARCHAR(400),
    "video_key" VARCHAR(400) NOT NULL,
    "bucket" VARCHAR(80) NOT NULL,
    "duration_sec" INTEGER,
    "size_bytes" INTEGER,
    "mime_type" VARCHAR(120) NOT NULL DEFAULT 'video/mp4',
    "price_minor" INTEGER NOT NULL DEFAULT 100000,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "is_premium" BOOLEAN NOT NULL DEFAULT true,
    "status" "VideoStatus" NOT NULL DEFAULT 'DRAFT',
    "moderation_note" VARCHAR(500),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "payment_item_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "status" "VideoPurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "EntitlementType" NOT NULL,
    "resource_id" VARCHAR(64),
    "payment_item_id" UUID,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_shares" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "status" "LocationShareStatus" NOT NULL DEFAULT 'PENDING',
    "requested_minutes" INTEGER NOT NULL,
    "note" VARCHAR(255),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_share_permissions" (
    "id" UUID NOT NULL,
    "share_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_share_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensitive_access_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(40),
    "subject_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(255),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensitive_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL,
    "caller_id" UUID NOT NULL,
    "callee_id" UUID NOT NULL,
    "conversation_id" UUID,
    "type" "CallType" NOT NULL DEFAULT 'VOICE',
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "sdp_offer" TEXT,
    "sdp_answer" TEXT,
    "ice_candidates" JSONB,
    "ring_timeout_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(120) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPPORT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(120),
    "meta" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DatePlanToSafetyContact" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_DatePlanToSafetyContact_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_hash_key" ON "users"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "device_sessions_user_id_idx" ON "device_sessions"("user_id");

-- CreateIndex
CREATE INDEX "verification_codes_target_purpose_idx" ON "verification_codes"("target", "purpose");

-- CreateIndex
CREATE INDEX "verification_codes_expires_at_idx" ON "verification_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE INDEX "profiles_displayed_area_node_id_idx" ON "profiles"("displayed_area_node_id");

-- CreateIndex
CREATE INDEX "profiles_last_active_at_idx" ON "profiles"("last_active_at");

-- CreateIndex
CREATE UNIQUE INDEX "profile_photos_media_id_key" ON "profile_photos"("media_id");

-- CreateIndex
CREATE INDEX "profile_photos_user_id_position_idx" ON "profile_photos"("user_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "profile_videos_media_id_key" ON "profile_videos"("media_id");

-- CreateIndex
CREATE INDEX "profile_videos_user_id_idx" ON "profile_videos"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "interests_slug_key" ON "interests"("slug");

-- CreateIndex
CREATE INDEX "user_interests_profile_id_idx" ON "user_interests"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "supported_regions_slug_key" ON "supported_regions"("slug");

-- CreateIndex
CREATE INDEX "supported_regions_is_active_idx" ON "supported_regions"("is_active");

-- CreateIndex
CREATE INDEX "location_nodes_region_id_kind_is_active_idx" ON "location_nodes"("region_id", "kind", "is_active");

-- CreateIndex
CREATE INDEX "location_nodes_parent_id_idx" ON "location_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "location_nodes_center_lat_center_lng_idx" ON "location_nodes"("center_lat", "center_lng");

-- CreateIndex
CREATE UNIQUE INDEX "location_nodes_region_id_slug_key" ON "location_nodes"("region_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "place_categories_slug_key" ON "place_categories"("slug");

-- CreateIndex
CREATE INDEX "location_places_category_id_is_active_idx" ON "location_places"("category_id", "is_active");

-- CreateIndex
CREATE INDEX "location_places_latitude_longitude_idx" ON "location_places"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "location_places_node_id_idx" ON "location_places"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_places_region_id_slug_key" ON "location_places"("region_id", "slug");

-- CreateIndex
CREATE INDEX "place_photos_place_id_position_idx" ON "place_photos"("place_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "geofences_place_id_key" ON "geofences"("place_id");

-- CreateIndex
CREATE INDEX "geofences_region_id_is_active_idx" ON "geofences"("region_id", "is_active");

-- CreateIndex
CREATE INDEX "geofences_node_id_idx" ON "geofences"("node_id");

-- CreateIndex
CREATE INDEX "user_locations_area_node_id_idx" ON "user_locations"("area_node_id");

-- CreateIndex
CREATE INDEX "discovery_preferences_relationship_goal_idx" ON "discovery_preferences"("relationship_goal");

-- CreateIndex
CREATE INDEX "user_location_events_user_id_created_at_idx" ON "user_location_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_location_events_node_id_created_at_idx" ON "user_location_events"("node_id", "created_at");

-- CreateIndex
CREATE INDEX "swipes_target_id_type_idx" ON "swipes"("target_id", "type");

-- CreateIndex
CREATE INDEX "swipes_swiper_id_created_at_idx" ON "swipes"("swiper_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "swipes_swiper_id_target_id_key" ON "swipes"("swiper_id", "target_id");

-- CreateIndex
CREATE INDEX "matches_user_a_id_state_idx" ON "matches"("user_a_id", "state");

-- CreateIndex
CREATE INDEX "matches_user_b_id_state_idx" ON "matches"("user_b_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "matches_user_a_id_user_b_id_key" ON "matches"("user_a_id", "user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_match_id_key" ON "conversations"("match_id");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_id_key" ON "messages"("conversation_id", "client_id");

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_key_key" ON "media"("storage_key");

-- CreateIndex
CREATE INDEX "media_owner_id_type_idx" ON "media"("owner_id", "type");

-- CreateIndex
CREATE INDEX "media_moderation_media_id_status_idx" ON "media_moderation"("media_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key" ON "blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_hides_owner_id_target_id_key" ON "profile_hides"("owner_id", "target_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_reported_user_id_idx" ON "reports"("reported_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_public_id_key" ON "verifications"("public_id");

-- CreateIndex
CREATE INDEX "verifications_status_type_idx" ON "verifications"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_user_id_type_key" ON "verifications"("user_id", "type");

-- CreateIndex
CREATE INDEX "stories_user_id_expires_at_idx" ON "stories"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "stories_expires_at_idx" ON "stories"("expires_at");

-- CreateIndex
CREATE INDEX "posts_user_id_created_at_idx" ON "posts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "post_media_post_id_position_idx" ON "post_media"("post_id", "position");

-- CreateIndex
CREATE INDEX "post_comments_post_id_created_at_idx" ON "post_comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "date_plans_conversation_id_scheduled_for_idx" ON "date_plans"("conversation_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "date_check_ins_date_plan_id_type_idx" ON "date_check_ins"("date_plan_id", "type");

-- CreateIndex
CREATE INDEX "safety_contacts_user_id_idx" ON "safety_contacts"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments"("provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_user_id_status_created_at_idx" ON "payments"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_type_status_idx" ON "payments"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_items_subscription_id_key" ON "payment_items"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_items_boost_id_key" ON "payment_items"("boost_id");

-- CreateIndex
CREATE INDEX "payment_items_payment_id_idx" ON "payment_items"("payment_id");

-- CreateIndex
CREATE INDEX "payment_items_product_type_product_id_idx" ON "payment_items"("product_type", "product_id");

-- CreateIndex
CREATE INDEX "boosts_user_id_ends_at_idx" ON "boosts"("user_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_unlocks_payment_item_id_key" ON "contact_unlocks"("payment_item_id");

-- CreateIndex
CREATE INDEX "contact_unlocks_profile_owner_id_status_idx" ON "contact_unlocks"("profile_owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_unlocks_buyer_id_profile_owner_id_key" ON "contact_unlocks"("buyer_id", "profile_owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_categories_slug_key" ON "video_categories"("slug");

-- CreateIndex
CREATE INDEX "premium_videos_status_category_id_idx" ON "premium_videos"("status", "category_id");

-- CreateIndex
CREATE INDEX "premium_videos_is_premium_idx" ON "premium_videos"("is_premium");

-- CreateIndex
CREATE UNIQUE INDEX "video_purchases_payment_item_id_key" ON "video_purchases"("payment_item_id");

-- CreateIndex
CREATE INDEX "video_purchases_video_id_status_idx" ON "video_purchases"("video_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "video_purchases_user_id_video_id_key" ON "video_purchases"("user_id", "video_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_payment_item_id_key" ON "entitlements"("payment_item_id");

-- CreateIndex
CREATE INDEX "entitlements_user_id_type_idx" ON "entitlements"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_user_id_type_resource_id_key" ON "entitlements"("user_id", "type", "resource_id");

-- CreateIndex
CREATE INDEX "location_shares_requester_id_status_idx" ON "location_shares"("requester_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_shares_owner_id_requester_id_key" ON "location_shares"("owner_id", "requester_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_share_permissions_share_id_key" ON "location_share_permissions"("share_id");

-- CreateIndex
CREATE INDEX "location_share_permissions_recipient_id_ended_at_idx" ON "location_share_permissions"("recipient_id", "ended_at");

-- CreateIndex
CREATE INDEX "location_share_permissions_expires_at_idx" ON "location_share_permissions"("expires_at");

-- CreateIndex
CREATE INDEX "sensitive_access_logs_actor_id_created_at_idx" ON "sensitive_access_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "sensitive_access_logs_subject_id_created_at_idx" ON "sensitive_access_logs"("subject_id", "created_at");

-- CreateIndex
CREATE INDEX "call_sessions_caller_id_created_at_idx" ON "call_sessions"("caller_id", "created_at");

-- CreateIndex
CREATE INDEX "call_sessions_callee_id_created_at_idx" ON "call_sessions"("callee_id", "created_at");

-- CreateIndex
CREATE INDEX "call_sessions_status_ring_timeout_at_idx" ON "call_sessions"("status", "ring_timeout_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_user_id_key" ON "admin_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_logs_created_at_idx" ON "admin_logs"("created_at");

-- CreateIndex
CREATE INDEX "admin_logs_entity_type_entity_id_idx" ON "admin_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "_DatePlanToSafetyContact_B_index" ON "_DatePlanToSafetyContact"("B");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_displayed_area_node_id_fkey" FOREIGN KEY ("displayed_area_node_id") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_profile_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_videos" ADD CONSTRAINT "profile_videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_videos" ADD CONSTRAINT "profile_videos_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_videos" ADD CONSTRAINT "profile_videos_profile_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_nodes" ADD CONSTRAINT "location_nodes_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "supported_regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_nodes" ADD CONSTRAINT "location_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_places" ADD CONSTRAINT "location_places_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "supported_regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_places" ADD CONSTRAINT "location_places_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_places" ADD CONSTRAINT "location_places_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "place_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "location_places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "supported_regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "location_places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_area_node_id_fkey" FOREIGN KEY ("area_node_id") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_privacy_settings" ADD CONSTRAINT "user_privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_preferences" ADD CONSTRAINT "discovery_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_events" ADD CONSTRAINT "user_location_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_events" ADD CONSTRAINT "user_location_events_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_events" ADD CONSTRAINT "user_location_events_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_swiper_id_fkey" FOREIGN KEY ("swiper_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_moderation" ADD CONSTRAINT "media_moderation_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_moderation" ADD CONSTRAINT "media_moderation_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_hides" ADD CONSTRAINT "profile_hides_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_hides" ADD CONSTRAINT "profile_hides_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_post_id_fkey" FOREIGN KEY ("reported_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "location_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_plan_participants" ADD CONSTRAINT "date_plan_participants_date_plan_id_fkey" FOREIGN KEY ("date_plan_id") REFERENCES "date_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_plan_participants" ADD CONSTRAINT "date_plan_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_check_ins" ADD CONSTRAINT "date_check_ins_date_plan_id_fkey" FOREIGN KEY ("date_plan_id") REFERENCES "date_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_check_ins" ADD CONSTRAINT "date_check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_contacts" ADD CONSTRAINT "safety_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_contacts" ADD CONSTRAINT "safety_contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_boost_id_fkey" FOREIGN KEY ("boost_id") REFERENCES "boosts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosts" ADD CONSTRAINT "boosts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_unlocks" ADD CONSTRAINT "contact_unlocks_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_unlocks" ADD CONSTRAINT "contact_unlocks_profile_owner_id_fkey" FOREIGN KEY ("profile_owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_unlocks" ADD CONSTRAINT "contact_unlocks_payment_item_id_fkey" FOREIGN KEY ("payment_item_id") REFERENCES "payment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_videos" ADD CONSTRAINT "premium_videos_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "video_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_purchases" ADD CONSTRAINT "video_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_purchases" ADD CONSTRAINT "video_purchases_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "premium_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_purchases" ADD CONSTRAINT "video_purchases_payment_item_id_fkey" FOREIGN KEY ("payment_item_id") REFERENCES "payment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_payment_item_id_fkey" FOREIGN KEY ("payment_item_id") REFERENCES "payment_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_share_permissions" ADD CONSTRAINT "location_share_permissions_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "location_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_share_permissions" ADD CONSTRAINT "location_share_permissions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_share_permissions" ADD CONSTRAINT "location_share_permissions_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitive_access_logs" ADD CONSTRAINT "sensitive_access_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_callee_id_fkey" FOREIGN KEY ("callee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_logs" ADD CONSTRAINT "admin_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DatePlanToSafetyContact" ADD CONSTRAINT "_DatePlanToSafetyContact_A_fkey" FOREIGN KEY ("A") REFERENCES "date_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DatePlanToSafetyContact" ADD CONSTRAINT "_DatePlanToSafetyContact_B_fkey" FOREIGN KEY ("B") REFERENCES "safety_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
