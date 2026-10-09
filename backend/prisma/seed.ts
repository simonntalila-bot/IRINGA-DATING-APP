/**
 * Development seed.
 *
 * Rules followed here (spec sections 39 and 45):
 *  - NO fabricated Iringa businesses. No invented restaurants, hotels or
 *    "dating spots" are created. Only place CATEGORIES are seeded, so an admin
 *    can add real, verified places from the admin panel.
 *  - Administrative geography (region / district / municipality) is seeded with
 *    the published administrative names. Their coordinates are explicitly
 *    marked as approximate and must be verified by an admin before being used
 *    as a geofence boundary.
 *  - Development user accounts are clearly labelled as such.
 */

import { PrismaClient, PlaceCategorySlug, LocationKind, RelationshipGoal, Gender } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

// Mirrors EncryptionService so seeded rows stay consistent with runtime lookups.
const phoneKey = createHmac('sha256', process.env.PHONE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev').digest();
const encrypt = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', phoneKey, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(
    '.',
  );
};
const hashPhone = (value: string): string => createHmac('sha256', phoneKey).update(value).digest('hex');

const CENTRE = { lat: -7.7669, lng: 35.2313 };

async function seedRegions() {
  const region = await prisma.supportedRegion.upsert({
    where: { slug: 'iringa' },
    create: {
      slug: 'iringa',
      name: 'Iringa',
      countryCode: 'TZ',
      centerLat: CENTRE.lat,
      centerLng: CENTRE.lng,
      defaultRadiusKm: 60,
      isActive: true,
    },
    update: {},
  });

  // Administrative levels only. No business or venue data.
  const nodes: Array<{
    slug: string;
    name: string;
    kind: LocationKind;
    description: string;
    radiusM: number;
  }> = [
    {
      slug: 'iringa-region',
      name: 'Iringa Region',
      kind: LocationKind.DISTRICT,
      description: 'Administrative region. Region-level node used for the Iringa-only boundary.',
      radiusM: 120_000,
    },
    {
      slug: 'iringa-district',
      name: 'Iringa District',
      kind: LocationKind.DISTRICT,
      description: 'Iringa District council area (administrative).',
      radiusM: 40_000,
    },
    {
      slug: 'iringa-municipal-council',
      name: 'Iringa Municipal Council',
      kind: LocationKind.MUNICIPALITY,
      description: 'Urban Iringa municipality. Approximate centre only - verify before using as a geofence.',
      radiusM: 20_000,
    },
  ];

  for (const node of nodes) {
    await prisma.locationNode.upsert({
      where: { regionId_slug: { regionId: region.id, slug: node.slug } },
      create: {
        regionId: region.id,
        kind: node.kind,
        name: node.name,
        slug: node.slug,
        description: node.description,
        centerLat: CENTRE.lat,
        centerLng: CENTRE.lng,
        radiusM: node.radiusM,
        isActive: true,
      },
      update: { description: node.description },
    });
  }

  return region;
}

async function seedPlaceCategories() {
  const categories: Array<{
    slug: PlaceCategorySlug;
    labelEn: string;
    labelSw: string;
    emoji: string;
    isDatingSpot: boolean;
    sortOrder: number;
  }> = [
    {
      slug: PlaceCategorySlug.DATING_SPOT,
      labelEn: 'Dating spots',
      labelSw: 'Mahali ya randi',
      emoji: '\u{2764}\u{FE0F}',
      isDatingSpot: true,
      sortOrder: 1,
    },
    {
      slug: PlaceCategorySlug.RESTAURANT,
      labelEn: 'Restaurants',
      labelSw: 'Migahawa',
      emoji: '\u{1F37D}\u{FE0F}',
      isDatingSpot: true,
      sortOrder: 2,
    },
    {
      slug: PlaceCategorySlug.CAFE,
      labelEn: 'Cafes',
      labelSw: 'Kahawa',
      emoji: '\u{2615}',
      isDatingSpot: true,
      sortOrder: 3,
    },
    {
      slug: PlaceCategorySlug.ENTERTAINMENT,
      labelEn: 'Entertainment',
      labelSw: 'Burudani',
      emoji: '\u{1F3B5}',
      isDatingSpot: true,
      sortOrder: 4,
    },
    {
      slug: PlaceCategorySlug.HOTEL,
      labelEn: 'Hotels',
      labelSw: 'Hoteli',
      emoji: '\u{1F3E8}',
      isDatingSpot: false,
      sortOrder: 5,
    },
    {
      slug: PlaceCategorySlug.EVENT,
      labelEn: 'Events',
      labelSw: 'Matukio',
      emoji: '\u{1F389}',
      isDatingSpot: true,
      sortOrder: 6,
    },
    {
      slug: PlaceCategorySlug.OUTDOOR,
      labelEn: 'Outdoor',
      labelSw: 'Nje',
      emoji: '\u{1F333}',
      isDatingSpot: true,
      sortOrder: 7,
    },
    {
      slug: PlaceCategorySlug.FITNESS,
      labelEn: 'Fitness',
      labelSw: 'Mazoizi',
      emoji: '\u{1F3CB}\u{FE0F}',
      isDatingSpot: false,
      sortOrder: 8,
    },
    {
      slug: PlaceCategorySlug.CINEMA,
      labelEn: 'Movies',
      labelSw: 'Sinema',
      emoji: '\u{1F3AC}',
      isDatingSpot: true,
      sortOrder: 9,
    },
    {
      slug: PlaceCategorySlug.SHOPPING,
      labelEn: 'Shopping',
      labelSw: 'Ununuzi',
      emoji: '\u{1F6CD}\u{FE0F}',
      isDatingSpot: false,
      sortOrder: 10,
    },
    {
      slug: PlaceCategorySlug.OTHER,
      labelEn: 'Other',
      labelSw: 'Nyingine',
      emoji: '\u{1F4CD}',
      isDatingSpot: false,
      sortOrder: 99,
    },
  ];

  for (const category of categories) {
    await prisma.placeCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: { labelEn: category.labelEn, labelSw: category.labelSw, emoji: category.emoji },
    });
  }
}

async function seedInterests() {
  // Emojis are written as Unicode escapes on purpose: a plain emoji literal can
  // be corrupted by any tool that re-encodes the file, and a mangled byte
  // sequence will not fit the column.
  const interests: Array<{ slug: string; en: string; sw: string; emoji: string; category: string }> = [
    { slug: 'music', en: 'Music', sw: 'Muziki', emoji: '\u{1F3B5}', category: 'culture' },
    { slug: 'travel', en: 'Travel', sw: 'Safari', emoji: '\u{2708}\u{FE0F}', category: 'lifestyle' },
    { slug: 'cooking', en: 'Cooking', sw: 'Kupika', emoji: '\u{1F373}', category: 'lifestyle' },
    { slug: 'sports', en: 'Sports', sw: 'Michezo', emoji: '\u{26BD}', category: 'lifestyle' },
    { slug: 'gym', en: 'Fitness', sw: 'Mazoizi', emoji: '\u{1F3CB}\u{FE0F}', category: 'lifestyle' },
    { slug: 'reading', en: 'Reading', sw: 'Kusoma', emoji: '\u{1F4DA}', category: 'culture' },
    { slug: 'movies', en: 'Movies', sw: 'Filamu', emoji: '\u{1F3AC}', category: 'culture' },
    { slug: 'art', en: 'Art', sw: 'Uch Sanaa', emoji: '\u{1F3A8}', category: 'culture' },
    { slug: 'gaming', en: 'Gaming', sw: 'Michezo ya kielekeo', emoji: '\u{1F3AE}', category: 'lifestyle' },
    { slug: 'dancing', en: 'Dancing', sw: 'Kucheza', emoji: '\u{1F483}', category: 'culture' },
    { slug: 'religion', en: 'Religion', sw: 'Dini', emoji: '\u{1F54C}', category: 'values' },
    {
      slug: 'family',
      en: 'Family',
      sw: 'Familia',
      emoji: '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}',
      category: 'values',
    },
    { slug: 'volunteering', en: 'Volunteering', sw: 'Kujitolea', emoji: '\u{1F91D}', category: 'values' },
    { slug: 'business', en: 'Business', sw: 'Biashara', emoji: '\u{1F4BC}', category: 'work' },
    { slug: 'fashion', en: 'Fashion', sw: 'Mavazi', emoji: '\u{1F457}', category: 'lifestyle' },
    { slug: 'photography', en: 'Photography', sw: 'Pichaxi', emoji: '\u{1F4F7}', category: 'culture' },
    { slug: 'hiking', en: 'Hiking', sw: 'Kutembea milimani', emoji: '\u{1F97E}', category: 'outdoor' },
    { slug: 'beach', en: 'Beach', sw: 'Pwani', emoji: '\u{1F3D6}\u{FE0F}', category: 'outdoor' },
    {
      slug: 'swahili',
      en: 'Swahili culture',
      sw: 'Utamaduni wa Kiswahili',
      emoji: '\u{1F1F9}\u{1F1FF}',
      category: 'culture',
    },
    { slug: 'tech', en: 'Technology', sw: 'Teknolojia', emoji: '\u{1F4BB}', category: 'work' },
  ];

  for (const interest of interests) {
    await prisma.interest.upsert({
      where: { slug: interest.slug },
      create: {
        slug: interest.slug,
        labelEn: interest.en,
        labelSw: interest.sw,
        emoji: interest.emoji,
        category: interest.category,
      },
      update: {},
    });
  }
}

/**
 * Development accounts ONLY. Phone numbers are in a reserved test range and the
 * display names are obviously synthetic so nobody mistakes them for real users.
 */
async function seedDevUsers() {
  const passwordHash = await bcrypt.hash('DevOnly_12345', 12);

  const demo = [
    { phone: '+255700000001', name: 'DevUser Alpha', gender: Gender.FEMALE, goal: RelationshipGoal.SERIOUS_DATING },
    { phone: '+255700000002', name: 'DevUser Beta', gender: Gender.MALE, goal: RelationshipGoal.SERIOUS_DATING },
    { phone: '+255700000003', name: 'DevUser Gamma', gender: Gender.FEMALE, goal: RelationshipGoal.LONG_TERM },
  ];

  for (const [index, item] of demo.entries()) {
    const phoneHash = hashPhone(item.phone);
    const existing = await prisma.user.findUnique({ where: { phoneHash } });
    if (existing) continue;

    const user = await prisma.user.create({
      data: {
        phoneHash,
        phoneEncrypted: encrypt(item.phone),
        passwordHash,
        status: 'ACTIVE',
        phoneVerifiedAt: new Date(),
        ageConfirmedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    await prisma.profile.create({
      data: {
        userId: user.id,
        displayName: item.name,
        dateOfBirth: new Date(Date.UTC(1995 + index, index, 12)),
        gender: item.gender,
        interestedIn: item.gender === Gender.FEMALE ? [Gender.MALE] : [Gender.FEMALE],
        relationshipGoal: item.goal,
        bio: 'DEVELOPMENT ACCOUNT - seeded by prisma/seed.ts for local testing only.',
        languages: ['sw', 'en'],
        hobbies: ['music', 'travel'],
        profileCompletePct: 60,
        minAge: 18,
        maxAge: 60,
        maxDistanceKm: 50,
      },
    });

    await prisma.userPrivacySettings.create({ data: { userId: user.id } });
    await prisma.discoveryPreference.create({
      data: {
        userId: user.id,
        preferredGender: item.gender === 'MALE' ? ['FEMALE'] : ['MALE'],
      },
    });
    await prisma.verification.create({
      data: { userId: user.id, type: 'PHONE', status: 'APPROVED', publicId: `dev${index}${user.id.slice(0, 6)}` },
    });
  }
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@iringadating.local';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe_Admin_123';
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash, role: 'SUPER_ADMIN', isActive: true },
    update: {},
  });
}

async function main() {
  console.log('Seeding Iringa Dating development data...');
  const region = await seedRegions();
  await seedPlaceCategories();
  await seedInterests();
  await seedDevUsers();
  await seedAdmin();

  console.log(`Region ready: ${region.name} (${region.slug})`);
  console.log(
    [
      'DONE.',
      'Note: no Iringa venues were invented. Add real, verified places from',
      'the admin panel (POST /api/v1/admin/places) and then create areas,',
      'villages and streets with POST /api/v1/admin/locations.',
    ].join(' '),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
