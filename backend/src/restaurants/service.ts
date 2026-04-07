import { DishStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { searchGooglePlaces } from '../integrations/googlePlaces';
import { syncRestaurantMenu, type MenuSyncResult } from '../dishes/service';

type SearchMatchReason = 'name' | 'cuisine' | 'dishType';

export type SearchRestaurantResult = Awaited<ReturnType<typeof prisma.restaurant.upsert>> & {
  cuisines: string[];
  dishTypes: string[];
  matchReasons: SearchMatchReason[];
};

const CUISINE_BY_GOOGLE_TYPE: Record<string, string> = {
  italian_restaurant: 'Italian',
  mexican_restaurant: 'Mexican',
  thai_restaurant: 'Thai',
  chinese_restaurant: 'Chinese',
  japanese_restaurant: 'Japanese',
  korean_restaurant: 'Korean',
  vietnamese_restaurant: 'Vietnamese',
  indian_restaurant: 'Indian',
  spanish_restaurant: 'Spanish',
  french_restaurant: 'French',
  greek_restaurant: 'Greek',
  mediterranean_restaurant: 'Mediterranean',
  turkish_restaurant: 'Turkish',
  lebanese_restaurant: 'Lebanese',
  american_restaurant: 'American',
  barbecue_restaurant: 'Barbecue',
  seafood_restaurant: 'Seafood',
  sushi_restaurant: 'Sushi',
  ramen_restaurant: 'Ramen',
  steak_house: 'Steakhouse',
  pizza_restaurant: 'Pizza',
  hamburger_restaurant: 'Burgers',
};

const DISH_TYPE_RULES: Array<{ label: string; matchers: RegExp[] }> = [
  { label: 'Burgers', matchers: [/\bburger\b/i, /\bburgers\b/i, /\bpatty melt\b/i] },
  { label: 'Chicken', matchers: [/\bchicken\b/i, /\bwings?\b/i, /\btenders?\b/i] },
  {
    label: 'Pasta',
    matchers: [/\bpasta\b/i, /\bspaghetti\b/i, /\bfettuccine\b/i, /\blinguine\b/i, /\bnoodles?\b/i],
  },
  { label: 'Pizza', matchers: [/\bpizza\b/i, /\bmargherita\b/i, /\bpepperoni\b/i] },
  { label: 'Seafood', matchers: [/\bseafood\b/i, /\bshrimp\b/i, /\bsalmon\b/i, /\bcrab\b/i, /\blobster\b/i] },
  { label: 'Tacos', matchers: [/\btacos?\b/i, /\bburritos?\b/i, /\bquesadilla\b/i] },
  { label: 'Sushi', matchers: [/\bsushi\b/i, /\bsashimi\b/i, /\brolls?\b/i] },
  { label: 'BBQ', matchers: [/\bbbq\b/i, /\bbarbecue\b/i, /\bribs?\b/i, /\bbrisket\b/i] },
  { label: 'Salads', matchers: [/\bsalads?\b/i, /\bcaesar\b/i, /\bgreens\b/i] },
  { label: 'Desserts', matchers: [/\bdesserts?\b/i, /\bcake\b/i, /\bice cream\b/i, /\bcookies?\b/i] },
];

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function mapCuisinesFromGoogleTypes(types: string[]): string[] {
  const cuisines = types
    .map((type) => CUISINE_BY_GOOGLE_TYPE[type])
    .filter((value): value is string => Boolean(value));

  return uniqueStrings(cuisines);
}

function inferDishTypesFromDishNames(dishNames: string[]): string[] {
  const detected: string[] = [];

  for (const dishName of dishNames) {
    for (const rule of DISH_TYPE_RULES) {
      if (rule.matchers.some((matcher) => matcher.test(dishName))) {
        detected.push(rule.label);
      }
    }
  }

  return uniqueStrings(detected);
}

function textIncludes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesAnyKeyword(values: string[], keyword: string): boolean {
  return values.some((value) => textIncludes(value, keyword) || textIncludes(keyword, value));
}

function buildSearchKeywords(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }

  const parts = trimmed
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  return uniqueStrings([trimmed, ...parts]);
}

function matchesAnyKeywordSet(values: string[], keywords: string[]): boolean {
  return keywords.some((keyword) => matchesAnyKeyword(values, keyword));
}

function matchesTextKeywords(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => textIncludes(value, keyword));
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function ratingSortValue(value: number | null): number {
  return value ?? Number.NEGATIVE_INFINITY;
}

const REVIEW_THEMES: Array<{ label: string; matchers: RegExp[] }> = [
  {
    label: 'flavor and seasoning',
    matchers: [/\bflavo?r\b/i, /\btaste\b/i, /\bseason\w*/i, /\bsalt\w*/i, /\bspice\w*/i],
  },
  {
    label: 'portion size',
    matchers: [/\bportion\b/i, /\bserving\b/i, /\bsize\b/i, /\bfilling\b/i, /\bsmall\b/i],
  },
  {
    label: 'value for price',
    matchers: [/\bvalue\b/i, /\bprice\b/i, /\bcost\b/i, /\bexpensive\b/i, /\boverpriced\b/i],
  },
  {
    label: 'presentation',
    matchers: [/\bpresent\w*/i, /\bplating\b/i, /\bvisual\b/i, /\blooks?\b/i],
  },
  {
    label: 'texture and freshness',
    matchers: [/\btexture\b/i, /\bfresh\w*/i, /\bcrispy\b/i, /\btender\b/i, /\bjuicy\b/i],
  },
];

function cleanReviewTextForSummary(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function pickDominantTheme(reviewTexts: string[]): string | null {
  const counts = REVIEW_THEMES.map((theme) => ({
    label: theme.label,
    count: 0,
  }));

  for (const text of reviewTexts) {
    for (let index = 0; index < REVIEW_THEMES.length; index += 1) {
      const theme = REVIEW_THEMES[index];
      if (theme.matchers.some((matcher) => matcher.test(text))) {
        counts[index].count += 1;
      }
    }
  }

  const top = counts.sort((a, b) => b.count - a.count)[0];
  if (!top || top.count === 0) {
    return null;
  }

  return top.label;
}

function pickRepresentativeSnippet(reviewTexts: string[]): string | null {
  const candidate = reviewTexts.find((text) => text.length >= 18) ?? reviewTexts[0] ?? null;
  if (!candidate) {
    return null;
  }

  const normalized = cleanReviewTextForSummary(candidate).replace(/[.!?]/g, '').trim();
  if (!normalized) {
    return null;
  }

  const maxChars = 90;
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}

function summarizeDishReviews(input: {
  reviewCount: number;
  avgDishScore: number | null;
  avgTaste: number | null;
  avgPortionSize: number | null;
  avgValue: number | null;
  avgPresentation: number | null;
  avgUniqueness: number | null;
  reviewTexts: string[];
}): string {
  if (!input.reviewCount) {
    return 'No reviews yet for this dish.';
  }

  const normalizedReviewTexts = input.reviewTexts.map(cleanReviewTextForSummary).filter(Boolean);

  const criteria = [
    { label: 'taste', value: input.avgTaste ?? 0 },
    { label: 'portion size', value: input.avgPortionSize ?? 0 },
    { label: 'value', value: input.avgValue ?? 0 },
    { label: 'presentation', value: input.avgPresentation ?? 0 },
    { label: 'uniqueness', value: input.avgUniqueness ?? 0 },
  ].sort((a, b) => b.value - a.value);

  const strongest = criteria[0];
  const weakest = criteria[criteria.length - 1];
  const overall = input.avgDishScore ?? 0;
  const dominantTheme = pickDominantTheme(normalizedReviewTexts);
  const representativeSnippet = pickRepresentativeSnippet(normalizedReviewTexts);

  const firstSentence = `${input.reviewCount} review${input.reviewCount === 1 ? '' : 's'} average ${roundToTwo(
    overall,
  )}/10, with strongest scores in ${strongest.label} (${roundToTwo(
    strongest.value,
  )}/10) and lower scores in ${weakest.label} (${roundToTwo(weakest.value)}/10).`;

  const secondSentence = dominantTheme
    ? `Across all submitted reviews, the most common feedback theme is ${dominantTheme}.`
    : representativeSnippet
      ? `Across all submitted reviews, diners often mention "${representativeSnippet}."`
      : 'As more written reviews are added, this summary will stay updated automatically.';

  return `${firstSentence} ${secondSentence}`;
}

export async function searchRestaurants(args: {
  query: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  cuisineFilters?: string[];
  dishTypeFilters?: string[];
}) {
  const normalizedQuery = args.query.trim().toLowerCase();
  const searchKeywords = buildSearchKeywords(args.query);
  const cuisineFilters = uniqueStrings((args.cuisineFilters ?? []).map((value) => value.trim()).filter(Boolean));
  const dishTypeFilters = uniqueStrings((args.dishTypeFilters ?? []).map((value) => value.trim()).filter(Boolean));
  const hasResolvedGeoInput = typeof args.lat === 'number' && typeof args.lng === 'number';
  const looksLikePostalCode = /^\d{5}(?:-\d{4})?$/.test(normalizedQuery);

  const places = await searchGooglePlaces(args);

  const records = await Promise.all(
    places.map(async (place) => {
      const restaurant = await prisma.restaurant.upsert({
        where: {
          googlePlacesRef: place.placeId,
        },
        update: {
          name: place.name,
          address: place.address,
          phone: place.phone,
          website: place.website,
        },
        create: {
          name: place.name,
          googlePlacesRef: place.placeId,
          address: place.address,
          phone: place.phone,
          website: place.website,
        },
      });

      return {
        restaurant,
        place,
      };
    }),
  );

  const restaurantIds = records.map((entry) => entry.restaurant.id);
  const dishesByRestaurant = await prisma.dish.findMany({
    where: {
      restaurantId: {
        in: restaurantIds,
      },
    },
    select: {
      restaurantId: true,
      name: true,
      category: true,
    },
  });

  const dishNamesByRestaurantId = new Map<string, string[]>();
  for (const dish of dishesByRestaurant) {
    const existing = dishNamesByRestaurantId.get(dish.restaurantId) ?? [];
    existing.push(dish.name);
    dishNamesByRestaurantId.set(dish.restaurantId, existing);
  }

  const enriched: SearchRestaurantResult[] = records
    .map(({ restaurant, place }) => {
      const cuisines = mapCuisinesFromGoogleTypes(place.types ?? []);
      const dishTypes = inferDishTypesFromDishNames(dishNamesByRestaurantId.get(restaurant.id) ?? []);
      const matchReasons: SearchMatchReason[] = [];

      if (matchesTextKeywords(restaurant.name, searchKeywords)) {
        matchReasons.push('name');
      }

      if (matchesAnyKeywordSet(cuisines, searchKeywords)) {
        matchReasons.push('cuisine');
      }

      if (matchesAnyKeywordSet(dishTypes, searchKeywords)) {
        matchReasons.push('dishType');
      }

      return {
        ...restaurant,
        cuisines,
        dishTypes,
        matchReasons: uniqueStrings(matchReasons) as SearchMatchReason[],
      };
    })
    .filter((record) => {
      if (!searchKeywords.length) {
        return true;
      }

      const addressMatchesQuery = matchesTextKeywords(record.address, searchKeywords);
      if (hasResolvedGeoInput || looksLikePostalCode || addressMatchesQuery) {
        return true;
      }

      return record.matchReasons.length > 0;
    });

  const cuisineFiltered = cuisineFilters.length
    ? enriched.filter((record) => cuisineFilters.some((filterValue) => matchesAnyKeyword(record.cuisines, filterValue)))
    : enriched;

  const fullyFiltered = dishTypeFilters.length
    ? cuisineFiltered.filter((record) => dishTypeFilters.some((filterValue) => matchesAnyKeyword(record.dishTypes, filterValue)))
    : cuisineFiltered;

  return [...fullyFiltered].sort((a, b) => {
    const reasonDiff = b.matchReasons.length - a.matchReasons.length;
    if (reasonDiff !== 0) {
      return reasonDiff;
    }

    const overallDiff = ratingSortValue(b.overallRating) - ratingSortValue(a.overallRating);
    if (overallDiff !== 0) {
      return overallDiff;
    }

    const foodDiff = ratingSortValue(b.foodRating) - ratingSortValue(a.foodRating);
    if (foodDiff !== 0) {
      return foodDiff;
    }

    return a.name.localeCompare(b.name);
  });
}

export function parseSearchFilters(input: {
  cuisineFilters?: unknown;
  dishTypeFilters?: unknown;
}) {
  return {
    cuisineFilters: toStringArray(input.cuisineFilters),
    dishTypeFilters: toStringArray(input.dishTypeFilters),
  };
}

export async function getRestaurantProfile(restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      dishes: true,
    },
  });

  if (!restaurant) {
    throw new HttpError(404, 'Restaurant not found');
  }

  const topDishStats = await prisma.review.groupBy({
    by: ['dishId'],
    where: { restaurantId },
    _avg: { dishScore: true },
    _count: { _all: true },
  });

  const dishesById = new Map(restaurant.dishes.map((dish) => [dish.id, dish]));

  const ranked = topDishStats
    .map((stat) => {
      const dish = dishesById.get(stat.dishId);
      if (!dish || stat._avg.dishScore === null) {
        return null;
      }

      return {
        dishId: dish.id,
        name: dish.name,
        category: dish.category,
        avgScore: stat._avg.dishScore,
        reviewCount: stat._count._all,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const sortedDesc = [...ranked].sort((a, b) => b.avgScore - a.avgScore);
  const sortedAsc = [...ranked].sort((a, b) => a.avgScore - b.avgScore);

  const dishRatingAgg = await prisma.review.groupBy({
    by: ['dishId'],
    where: { restaurantId },
    _avg: {
      dishScore: true,
    },
    _count: {
      _all: true,
    },
  });

  const ratingByDishId = new Map(
    dishRatingAgg.map((agg) => [
      agg.dishId,
      {
        avgDishScore: agg._avg.dishScore,
        reviewCount: agg._count._all,
      },
    ]),
  );

  const mapDishForMenu = (dish: (typeof restaurant.dishes)[number]) => {
    const rating = ratingByDishId.get(dish.id);
    return {
      ...dish,
      avgDishScore: rating?.avgDishScore ?? null,
      reviewCount: rating?.reviewCount ?? 0,
    };
  };

  return {
    restaurant,
    topDishes: sortedDesc.slice(0, 3),
    bottomDishes: sortedAsc.slice(0, 3),
    menu: {
      activeAndSeasonal: restaurant.dishes
        .filter((d) => d.status !== DishStatus.HISTORICAL)
        .map(mapDishForMenu),
      historical: restaurant.dishes.filter((d) => d.status === DishStatus.HISTORICAL).map(mapDishForMenu),
    },
  };
}

export async function getRestaurantMenu(restaurantId: string) {
  const [dishes, dishRatingAgg] = await Promise.all([
    prisma.dish.findMany({
      where: { restaurantId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    }),
    prisma.review.groupBy({
      by: ['dishId'],
      where: { restaurantId },
      _avg: {
        dishScore: true,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const ratingByDishId = new Map(
    dishRatingAgg.map((agg) => [
      agg.dishId,
      {
        avgDishScore: agg._avg.dishScore,
        reviewCount: agg._count._all,
      },
    ]),
  );

  return dishes.map((dish) => {
    const rating = ratingByDishId.get(dish.id);
    return {
      ...dish,
      avgDishScore: rating?.avgDishScore ?? null,
      reviewCount: rating?.reviewCount ?? 0,
    };
  });
}

export async function getDishDetails(restaurantId: string, dishId: string) {
  const dish = await prisma.dish.findFirst({
    where: {
      id: dishId,
      restaurantId,
    },
  });

  if (!dish) {
    throw new HttpError(404, 'Dish not found');
  }

  const [aggregates, recentReviews, allReviewTexts, allReviewImages] = await Promise.all([
    prisma.review.aggregate({
      where: { dishId },
      _avg: {
        dishScore: true,
        tasteScore: true,
        portionSizeScore: true,
        valueScore: true,
        presentationScore: true,
        uniquenessScore: true,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.review.findMany({
      where: { dishId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        dishScore: true,
        tasteScore: true,
        portionSizeScore: true,
        valueScore: true,
        presentationScore: true,
        uniquenessScore: true,
        reviewText: true,
        imageUrl: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.review.findMany({
      where: {
        dishId,
        reviewText: {
          not: null,
        },
      },
      select: {
        reviewText: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.review.findMany({
      where: {
        dishId,
        imageUrl: {
          not: null,
        },
      },
      select: {
        imageUrl: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  const reviewTexts = allReviewTexts
    .map((review) => review.reviewText?.trim() ?? '')
    .filter((text) => Boolean(text));

  const photoUrls = Array.from(
    new Set(allReviewImages.map((review) => review.imageUrl ?? '').filter((url) => Boolean(url))),
  );

  return {
    dish,
    aggregates: {
      reviewCount: aggregates._count._all,
      avgDishScore: aggregates._avg.dishScore,
      avgTaste: aggregates._avg.tasteScore,
      avgPortionSize: aggregates._avg.portionSizeScore,
      avgValue: aggregates._avg.valueScore,
      avgPresentation: aggregates._avg.presentationScore,
      avgUniqueness: aggregates._avg.uniquenessScore,
      // Backward-compatible aliases during frontend rollout.
      avgPortion: aggregates._avg.portionSizeScore,
      avgCost: aggregates._avg.valueScore,
    },
    summary: summarizeDishReviews({
      reviewCount: aggregates._count._all,
      avgDishScore: aggregates._avg.dishScore,
      avgTaste: aggregates._avg.tasteScore,
      avgPortionSize: aggregates._avg.portionSizeScore,
      avgValue: aggregates._avg.valueScore,
      avgPresentation: aggregates._avg.presentationScore,
      avgUniqueness: aggregates._avg.uniquenessScore,
      reviewTexts,
    }),
    photos: photoUrls,
    recentReviews: recentReviews.map((review) => ({
      ...review,
      // Backward-compatible aliases during frontend rollout.
      portionScore: review.portionSizeScore,
      costScore: review.valueScore,
    })),
  };
}

export async function getRestaurantReviews(restaurantId: string, page = 1, limit = 20) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), 100);

  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where: { restaurantId },
      include: {
        mealReview: {
          select: {
            id: true,
            serviceScore: true,
            atmosphereScore: true,
            valueScore: true,
            reviewText: true,
            imageUrl: true,
            createdAt: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        dish: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
    prisma.review.count({ where: { restaurantId } }),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

export async function syncRestaurantMenuForViewing(restaurantId: string) {
  const result: MenuSyncResult = await syncRestaurantMenu(restaurantId, { forceRefresh: false });

  return {
    reason: result.reason,
    provider: result.provider,
    createdCount: result.createdCount,
    skippedCount: result.skippedCount,
    cachedUntil: result.cachedUntil,
    nextAllowedAt: result.nextAllowedAt,
  };
}
