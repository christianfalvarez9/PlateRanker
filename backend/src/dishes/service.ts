import { DishCategory, DishSource, DishStatus } from '@prisma/client';
import crypto from 'crypto';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { normalizeDishName } from '../utils/ratings';
import { fetchMenuForRestaurant } from '../integrations/menuProvider';

export type MenuSyncReason = 'FETCHED' | 'CACHE_FRESH' | 'COOLDOWN';

export type MenuSyncResult = {
  reason: MenuSyncReason;
  provider: string;
  created: Awaited<ReturnType<typeof prisma.dish.create>>[];
  createdCount: number;
  skippedCount: number;
  cachedUntil?: string;
  nextAllowedAt?: string;
};

type MenuSyncStateRecord = {
  restaurantId: string;
  provider: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextAllowedAt: Date | null;
  lastPayloadHash: string | null;
  lastError: string | null;
  failureCount: number;
};

type MenuSyncStateWrite = {
  restaurantId: string;
  provider: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextAllowedAt: Date | null;
  lastPayloadHash: string | null;
  lastError: string | null;
  failureCount: number;
};

const inFlightMenuSyncByRestaurant = new Map<string, Promise<MenuSyncResult>>();

const BLOCKED_SYNC_TERMS = [
  'menu',
  'home',
  'about',
  'contact',
  'privacy',
  'terms',
  'hours',
  'order online',
  'order now',
  'book now',
  'reserve',
  'reservation',
  'delivery',
  'pickup',
  'takeout',
  'catering',
  'events',
  'careers',
  'jobs',
  'faq',
  'support',
  'follow us',
  'instagram',
  'facebook',
  'twitter',
  'tiktok',
  'youtube',
  'directions',
  'call now',
  'open now',
  'closed now',
  'all rights reserved',
  'cookie policy',
  'gift card',
  'reviews',
  'restaurant',
  'staff',
];

const MENU_HEADING_TERMS = new Set([
  'appetizer',
  'appetizers',
  'entree',
  'entrees',
  'main',
  'mains',
  'main course',
  'side',
  'sides',
  'dessert',
  'desserts',
  'drinks',
  'beverages',
  'cocktails',
  'beer',
  'wine',
  'coffee',
  'tea',
  'lunch',
  'dinner',
  'brunch',
  'specials',
]);

const FOOD_HINT_TERMS = [
  'burger',
  'chicken',
  'beef',
  'steak',
  'pork',
  'fish',
  'shrimp',
  'sushi',
  'ramen',
  'pasta',
  'pizza',
  'taco',
  'burrito',
  'quesadilla',
  'sandwich',
  'salad',
  'soup',
  'fries',
  'wings',
  'dessert',
  'cake',
  'cookie',
  'ice cream',
];

const SINGLE_WORD_DISH_ALLOWLIST = new Set([
  'ramen',
  'udon',
  'pho',
  'sushi',
  'sashimi',
  'tacos',
  'nachos',
  'dumplings',
  'falafel',
  'shawarma',
  'gyro',
  'paella',
  'risotto',
  'gnocchi',
  'lasagna',
  'ravioli',
  'biryani',
  'teriyaki',
  'ceviche',
  'tiramisu',
  'cheesecake',
  'gelato',
]);

const GENERIC_ADJECTIVE_TERMS = new Set([
  'house',
  'signature',
  'special',
  'classic',
  'fresh',
  'new',
  'our',
  'chef',
]);

const ACTION_PREFIX_REGEX =
  /^(?:order|book|reserve|get|view|read|learn|follow|call|contact|sign|log|download|share)\b/i;
const DAY_OR_TIME_REGEX =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|\d{1,2}:\d{2})\b/i;

function tokenizeSyncCandidate(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isSyncCandidateAllowed(name: string): boolean {
  const cleaned = name.replace(/\s+/g, ' ').replace(/^[•·\-–—*\u2022\s]+/, '').trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 100) {
    return false;
  }

  if (/https?:\/\//i.test(cleaned) || /@/.test(cleaned)) {
    return false;
  }

  if (!/[a-z]/i.test(cleaned)) {
    return false;
  }

  const lower = cleaned.toLowerCase();
  if (BLOCKED_SYNC_TERMS.some((term) => lower.includes(term))) {
    return false;
  }

  if (ACTION_PREFIX_REGEX.test(lower) || DAY_OR_TIME_REGEX.test(lower)) {
    return false;
  }

  if (MENU_HEADING_TERMS.has(lower)) {
    return false;
  }

  if (lower.endsWith(' menu') && MENU_HEADING_TERMS.has(lower.replace(/\s+menu$/, '').trim())) {
    return false;
  }

  const tokens = tokenizeSyncCandidate(cleaned);
  if (!tokens.length || tokens.length > 9) {
    return false;
  }

  const hasFoodHint = FOOD_HINT_TERMS.some((term) => lower.includes(term));

  if (tokens.length === 1) {
    if (!SINGLE_WORD_DISH_ALLOWLIST.has(tokens[0]) && !hasFoodHint) {
      return false;
    }
  }

  if (
    !hasFoodHint &&
    tokens.length <= 2 &&
    tokens.every((token) => GENERIC_ADJECTIVE_TERMS.has(token))
  ) {
    return false;
  }

  return true;
}

async function getMenuSyncState(restaurantId: string): Promise<MenuSyncStateRecord | null> {
  const rows = await prisma.$queryRaw<MenuSyncStateRecord[]>`
    SELECT
      "restaurantId",
      "provider",
      "lastAttemptAt",
      "lastSuccessAt",
      "nextAllowedAt",
      "lastPayloadHash",
      "lastError",
      "failureCount"
    FROM "MenuSyncState"
    WHERE "restaurantId" = ${restaurantId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function saveMenuSyncState(state: MenuSyncStateWrite): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "MenuSyncState" (
      "restaurantId",
      "provider",
      "lastAttemptAt",
      "lastSuccessAt",
      "nextAllowedAt",
      "lastPayloadHash",
      "lastError",
      "failureCount",
      "updatedAt"
    ) VALUES (
      ${state.restaurantId},
      ${state.provider},
      ${state.lastAttemptAt},
      ${state.lastSuccessAt},
      ${state.nextAllowedAt},
      ${state.lastPayloadHash},
      ${state.lastError},
      ${state.failureCount},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("restaurantId") DO UPDATE SET
      "provider" = EXCLUDED."provider",
      "lastAttemptAt" = EXCLUDED."lastAttemptAt",
      "lastSuccessAt" = EXCLUDED."lastSuccessAt",
      "nextAllowedAt" = EXCLUDED."nextAllowedAt",
      "lastPayloadHash" = EXCLUDED."lastPayloadHash",
      "lastError" = EXCLUDED."lastError",
      "failureCount" = EXCLUDED."failureCount",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

function hashMenuItems(items: Array<{ name: string; category: string; status: string; source: string }>): string {
  const canonical = items
    .map((item) => `${normalizeDishName(item.name)}|${item.category}|${item.status}|${item.source}`)
    .sort()
    .join(';');

  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function withInFlightDedup(restaurantId: string, runner: () => Promise<MenuSyncResult>): Promise<MenuSyncResult> {
  const existing = inFlightMenuSyncByRestaurant.get(restaurantId);
  if (existing) {
    return existing;
  }

  const promise = runner().finally(() => {
    inFlightMenuSyncByRestaurant.delete(restaurantId);
  });

  inFlightMenuSyncByRestaurant.set(restaurantId, promise);
  return promise;
}

export async function addDish(input: {
  restaurantId: string;
  name: string;
  category: DishCategory;
  status?: DishStatus;
  source?: DishSource;
}) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: input.restaurantId } });
  if (!restaurant) {
    throw new HttpError(404, 'Restaurant not found');
  }

  const dish = await prisma.dish.create({
    data: {
      restaurantId: input.restaurantId,
      name: input.name.trim(),
      nameNormalized: normalizeDishName(input.name),
      category: input.category,
      status: input.status ?? DishStatus.ACTIVE,
      source: input.source ?? DishSource.USER,
    },
  });

  return dish;
}

export async function flagDishUnavailable(dishId: string) {
  const dish = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!dish) {
    throw new HttpError(404, 'Dish not found');
  }

  const nextCount = dish.unavailableFlagCount + 1;
  const moveHistorical = nextCount >= 5;

  const updated = await prisma.dish.update({
    where: { id: dishId },
    data: {
      unavailableFlagCount: nextCount,
      isActive: moveHistorical ? false : dish.isActive,
      status: moveHistorical ? DishStatus.HISTORICAL : dish.status,
    },
  });

  return updated;
}

export async function prepopulateMenuFromProvider(restaurantId: string) {
  const result = await syncRestaurantMenu(restaurantId, { forceRefresh: true });
  return result.created;
}

export async function syncRestaurantMenu(
  restaurantId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<MenuSyncResult> {
  return withInFlightDedup(restaurantId, async () => {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) {
      throw new HttpError(404, 'Restaurant not found');
    }

    const now = new Date();
    const cacheTtlMs = env.menuCacheTtlHours * 60 * 60 * 1000;
    const syncState = await getMenuSyncState(restaurantId);

    if (
      !options.forceRefresh &&
      syncState?.nextAllowedAt &&
      syncState.nextAllowedAt.getTime() > now.getTime()
    ) {
      return {
        reason: 'COOLDOWN',
        provider: syncState.provider,
        created: [],
        createdCount: 0,
        skippedCount: 0,
        nextAllowedAt: syncState.nextAllowedAt.toISOString(),
      };
    }

    if (!options.forceRefresh && syncState?.lastSuccessAt) {
      const expiresAt = syncState.lastSuccessAt.getTime() + cacheTtlMs;
      if (expiresAt > now.getTime()) {
        return {
          reason: 'CACHE_FRESH',
          provider: syncState.provider,
          created: [],
          createdCount: 0,
          skippedCount: 0,
          cachedUntil: new Date(expiresAt).toISOString(),
        };
      }
    }

    try {
      const fetchResult = await fetchMenuForRestaurant({
        restaurantId: restaurant.id,
        name: restaurant.name,
        address: restaurant.address,
        website: restaurant.website,
        googlePlacesRef: restaurant.googlePlacesRef,
      });

      const created: Awaited<ReturnType<typeof prisma.dish.create>>[] = [];
      let skippedCount = 0;
      const seenNormalizedInBatch = new Set<string>();

      for (const item of fetchResult.items) {
        const cleanedName = item.name.replace(/\s+/g, ' ').replace(/^[•·\-–—*\u2022\s]+/, '').trim();

        if (!isSyncCandidateAllowed(cleanedName)) {
          skippedCount += 1;
          continue;
        }

        const normalized = normalizeDishName(cleanedName);

        if (!normalized || seenNormalizedInBatch.has(normalized)) {
          skippedCount += 1;
          continue;
        }

        seenNormalizedInBatch.add(normalized);

        const existing = await prisma.dish.findUnique({
          where: {
            restaurantId_nameNormalized: {
              restaurantId,
              nameNormalized: normalized,
            },
          },
        });

        if (existing) {
          skippedCount += 1;
          continue;
        }

        const dish = await prisma.dish.create({
          data: {
            restaurantId,
            name: cleanedName,
            nameNormalized: normalized,
            category: item.category,
            source: item.source,
            status: item.status,
          },
        });
        created.push(dish);
      }

      const payloadHash = hashMenuItems(fetchResult.items);

      await saveMenuSyncState({
        restaurantId,
        provider: fetchResult.provider,
        lastAttemptAt: now,
        lastSuccessAt: now,
        failureCount: 0,
        lastError: null,
        nextAllowedAt: null,
        lastPayloadHash: payloadHash,
      });

      return {
        reason: 'FETCHED',
        provider: fetchResult.provider,
        created,
        createdCount: created.length,
        skippedCount,
      };
    } catch (error) {
      const previousFailures = syncState?.failureCount ?? 0;
      const nextFailureCount = previousFailures + 1;
      const shouldCooldown = nextFailureCount >= 5;
      const nextAllowedAt = shouldCooldown
        ? new Date(now.getTime() + env.menuFailureCooldownMinutes * 60 * 1000)
        : null;

      await saveMenuSyncState({
        restaurantId,
        provider: syncState?.provider ?? 'google-places',
        lastAttemptAt: now,
        lastSuccessAt: syncState?.lastSuccessAt ?? null,
        failureCount: nextFailureCount,
        nextAllowedAt,
        lastError: error instanceof Error ? error.message : 'Menu sync failed',
        lastPayloadHash: syncState?.lastPayloadHash ?? null,
      });

      throw error;
    }
  });
}
