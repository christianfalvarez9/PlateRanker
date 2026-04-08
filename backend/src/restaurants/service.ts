import { DishStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { searchGooglePlaces } from '../integrations/googlePlaces';

type PlaceSearchResult = Awaited<ReturnType<typeof searchGooglePlaces>>[number];

type DiscoveryPlateItem = {
  dishId: string;
  dishName: string;
  restaurantId: string;
  restaurantName: string;
  currentDishRating: number;
  reviewCount: number;
};

type DiscoveryTrendingPlateItem = DiscoveryPlateItem & {
  trendIncrease: number;
  trendLabel: string;
};

type DiscoveryResponse = {
  location: string;
  topRatedPlates: DiscoveryPlateItem[];
  topRestaurants: Array<{
    restaurantId: string;
    restaurantName: string;
    overallRating: number;
  }>;
  trendingPlates: {
    available: boolean;
    reason: 'OK' | 'NO_RESULTS_FOR_LOCATION' | 'INSUFFICIENT_7_DAY_TREND_DATA';
    items: DiscoveryTrendingPlateItem[];
  };
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

const GENERIC_GOOGLE_PLACE_TYPES = new Set([
  'restaurant',
  'food',
  'point_of_interest',
  'establishment',
  'meal_takeaway',
  'meal_delivery',
]);

const CUISINE_TEXT_RULES: Array<{ label: string; matchers: RegExp[] }> = [
  { label: 'Italian', matchers: [/\bitalian\b/i] },
  { label: 'Mexican', matchers: [/\bmexican\b/i] },
  { label: 'Thai', matchers: [/\bthai\b/i] },
  { label: 'Chinese', matchers: [/\bchinese\b/i] },
  { label: 'Japanese', matchers: [/\bjapanese\b/i, /\bizakaya\b/i] },
  { label: 'Korean', matchers: [/\bkorean\b/i] },
  { label: 'Vietnamese', matchers: [/\bvietnamese\b/i] },
  { label: 'Indian', matchers: [/\bindian\b/i] },
  { label: 'Spanish', matchers: [/\bspanish\b/i] },
  { label: 'French', matchers: [/\bfrench\b/i] },
  { label: 'Greek', matchers: [/\bgreek\b/i] },
  { label: 'Mediterranean', matchers: [/\bmediterranean\b/i] },
  { label: 'Turkish', matchers: [/\bturkish\b/i] },
  { label: 'Lebanese', matchers: [/\blebanese\b/i] },
  { label: 'American', matchers: [/\bamerican\b/i] },
  { label: 'Barbecue', matchers: [/\bbbq\b/i, /\bbarbecue\b/i, /\bsmokehouse\b/i] },
  { label: 'Seafood', matchers: [/\bseafood\b/i, /\boyster\b/i, /\bcrab\b/i, /\blobster\b/i] },
  { label: 'Sushi', matchers: [/\bsushi\b/i, /\bsashimi\b/i] },
  { label: 'Ramen', matchers: [/\bramen\b/i] },
  { label: 'Steakhouse', matchers: [/\bsteak\s*house\b/i, /\bsteakhouse\b/i] },
  { label: 'Pizza', matchers: [/\bpizza\b/i, /\bpizzeria\b/i] },
  { label: 'Burgers', matchers: [/\bburgers?\b/i] },
  { label: 'Middle Eastern', matchers: [/\bmiddle\s*eastern\b/i, /\bshawarma\b/i, /\bfalafel\b/i] },
  { label: 'Fast Food', matchers: [/\bfast\s*food\b/i] },
  { label: 'Vegetarian', matchers: [/\bvegetarian\b/i] },
  { label: 'Vegan', matchers: [/\bvegan\b/i] },
];

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

function humanizeGoogleTypeCuisine(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => {
      if (part === 'bbq') {
        return 'BBQ';
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function inferCuisineFromGoogleType(type: string): string | null {
  const normalized = type.trim().toLowerCase();
  if (!normalized || GENERIC_GOOGLE_PLACE_TYPES.has(normalized)) {
    return null;
  }

  const mappedCuisine = CUISINE_BY_GOOGLE_TYPE[normalized];
  if (mappedCuisine) {
    return mappedCuisine;
  }

  if (normalized.endsWith('_restaurant')) {
    const cuisineSlug = normalized.replace(/_restaurant$/, '');
    const inferred = humanizeGoogleTypeCuisine(cuisineSlug);
    return inferred || null;
  }

  return null;
}

function mapCuisinesFromGoogleTypes(types: string[]): string[] {
  const cuisines = types
    .map((type) => inferCuisineFromGoogleType(type))
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

function inferCuisinesFromText(values: string[]): string[] {
  const detected: string[] = [];

  for (const value of values) {
    for (const rule of CUISINE_TEXT_RULES) {
      if (rule.matchers.some((matcher) => matcher.test(value))) {
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

const BROAD_RESTAURANT_SEARCH_TERMS = new Set([
  'restaurant',
  'restaurants',
  'food',
  'dining',
  'near',
  'nearby',
  'me',
  'local',
]);

function splitToWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isBroadRestaurantQuery(query: string): boolean {
  const words = splitToWords(query).filter((word) => word.length >= 2);
  if (!words.length) {
    return true;
  }

  return words.every((word) => BROAD_RESTAURANT_SEARCH_TERMS.has(word));
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function ratingSortValue(value: number | null): number {
  return value ?? Number.NEGATIVE_INFINITY;
}

async function upsertRestaurantsFromPlaces(places: PlaceSearchResult[]) {
  return Promise.all(
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
  location?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
}) {
  const searchKeywords = buildSearchKeywords(args.query);
  const broadQuery = isBroadRestaurantQuery(args.query);

  const places = await searchGooglePlaces(args);
  const records = await upsertRestaurantsFromPlaces(places);

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

  const rankedRecords = records
    .map(({ restaurant, place }) => {
      const dishNames = dishNamesByRestaurantId.get(restaurant.id) ?? [];
      const cuisines = uniqueStrings([
        ...mapCuisinesFromGoogleTypes(place.types ?? []),
        ...inferCuisinesFromText([restaurant.name, ...dishNames]),
        ...(place.placeId.startsWith('mock-') ? inferCuisinesFromText([args.query]) : []),
      ]);
      const dishTypes = inferDishTypesFromDishNames(dishNames);
      let matchReasonCount = 0;

      if (matchesTextKeywords(restaurant.name, searchKeywords)) {
        matchReasonCount += 1;
      }

      if (matchesAnyKeywordSet(cuisines, searchKeywords)) {
        matchReasonCount += 1;
      }

      if (matchesAnyKeywordSet(dishTypes, searchKeywords)) {
        matchReasonCount += 1;
      }

      return {
        restaurant,
        matchReasonCount,
      };
    })
    .filter((record) => {
      if (!searchKeywords.length || broadQuery) {
        return true;
      }

      return record.matchReasonCount > 0;
    });

  return [...rankedRecords]
    .sort((a, b) => {
      const reasonDiff = b.matchReasonCount - a.matchReasonCount;
      if (reasonDiff !== 0) {
        return reasonDiff;
      }

      const overallDiff = ratingSortValue(b.restaurant.overallRating) - ratingSortValue(a.restaurant.overallRating);
      if (overallDiff !== 0) {
        return overallDiff;
      }

      const foodDiff = ratingSortValue(b.restaurant.foodRating) - ratingSortValue(a.restaurant.foodRating);
      if (foodDiff !== 0) {
        return foodDiff;
      }

      return a.restaurant.name.localeCompare(b.restaurant.name);
    })
    .map((record) => record.restaurant);
}

export async function getLocationDiscovery(args: { location: string; radiusMiles?: number }): Promise<DiscoveryResponse> {
  const location = args.location.trim();
  const places = await searchGooglePlaces({
    query: 'restaurants',
    location,
    radiusMiles: args.radiusMiles,
  });
  const records = await upsertRestaurantsFromPlaces(places);
  const restaurantIds = uniqueStrings(records.map((entry) => entry.restaurant.id));

  if (!restaurantIds.length) {
    return {
      location,
      topRatedPlates: [],
      topRestaurants: [],
      trendingPlates: {
        available: false,
        reason: 'NO_RESULTS_FOR_LOCATION',
        items: [],
      },
    };
  }

  const [topRestaurantsRaw, allTimeDishAgg, recentDishAgg, previousDishAgg] = await Promise.all([
    prisma.restaurant.findMany({
      where: {
        id: {
          in: restaurantIds,
        },
        overallRating: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        overallRating: true,
      },
      orderBy: [{ overallRating: 'desc' }, { name: 'asc' }],
      take: 10,
    }),
    prisma.review.groupBy({
      by: ['dishId', 'restaurantId'],
      where: {
        restaurantId: {
          in: restaurantIds,
        },
      },
      _avg: {
        dishScore: true,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.review.groupBy({
      by: ['dishId', 'restaurantId'],
      where: {
        restaurantId: {
          in: restaurantIds,
        },
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
      _avg: {
        dishScore: true,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.review.groupBy({
      by: ['dishId', 'restaurantId'],
      where: {
        restaurantId: {
          in: restaurantIds,
        },
        createdAt: {
          gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
      _avg: {
        dishScore: true,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const dishIds = uniqueStrings(allTimeDishAgg.map((item) => item.dishId));
  const dishes = dishIds.length
    ? await prisma.dish.findMany({
        where: {
          id: {
            in: dishIds,
          },
        },
        select: {
          id: true,
          name: true,
          restaurant: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    : [];

  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));

  const allTimeByDishRestaurantKey = new Map<string, DiscoveryPlateItem>();
  for (const aggregate of allTimeDishAgg) {
    if (aggregate._avg.dishScore === null) {
      continue;
    }

    const dish = dishById.get(aggregate.dishId);
    if (!dish) {
      continue;
    }

    const item: DiscoveryPlateItem = {
      dishId: dish.id,
      dishName: dish.name,
      restaurantId: dish.restaurant.id,
      restaurantName: dish.restaurant.name,
      currentDishRating: roundToTwo(aggregate._avg.dishScore),
      reviewCount: aggregate._count._all,
    };

    allTimeByDishRestaurantKey.set(`${aggregate.dishId}:${aggregate.restaurantId}`, item);
  }

  const topRatedPlates = Array.from(allTimeByDishRestaurantKey.values())
    .sort((a, b) => {
      const ratingDiff = b.currentDishRating - a.currentDishRating;
      if (ratingDiff !== 0) {
        return ratingDiff;
      }

      const reviewCountDiff = b.reviewCount - a.reviewCount;
      if (reviewCountDiff !== 0) {
        return reviewCountDiff;
      }

      return a.dishName.localeCompare(b.dishName);
    })
    .slice(0, 10);

  const previousByDishRestaurantKey = new Map(
    previousDishAgg.map((aggregate) => [
      `${aggregate.dishId}:${aggregate.restaurantId}`,
      {
        average: aggregate._avg.dishScore,
        reviewCount: aggregate._count._all,
      },
    ]),
  );

  const trendingCandidates = recentDishAgg
    .map((recentAggregate) => {
      if (recentAggregate._avg.dishScore === null) {
        return null;
      }

      const key = `${recentAggregate.dishId}:${recentAggregate.restaurantId}`;
      const previous = previousByDishRestaurantKey.get(key);
      if (!previous || previous.average === null) {
        return null;
      }

      const baseDish = allTimeByDishRestaurantKey.get(key);
      if (!baseDish) {
        return null;
      }

      const trendIncrease = roundToTwo(recentAggregate._avg.dishScore - previous.average);
      if (trendIncrease <= 0) {
        return null;
      }

      return {
        ...baseDish,
        trendIncrease,
        trendLabel: `+${trendIncrease.toFixed(2)} vs previous 7 days`,
      } as DiscoveryTrendingPlateItem;
    })
    .filter((item): item is DiscoveryTrendingPlateItem => Boolean(item))
    .sort((a, b) => {
      const trendDiff = b.trendIncrease - a.trendIncrease;
      if (trendDiff !== 0) {
        return trendDiff;
      }

      return b.currentDishRating - a.currentDishRating;
    });

  const trendingTop = trendingCandidates.slice(0, 10);

  return {
    location,
    topRatedPlates,
    topRestaurants: topRestaurantsRaw.map((restaurant) => ({
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      overallRating: roundToTwo(restaurant.overallRating as number),
    })),
    trendingPlates:
      trendingTop.length < 10
        ? {
            available: false,
            reason: 'INSUFFICIENT_7_DAY_TREND_DATA',
            items: [],
          }
        : {
            available: true,
            reason: 'OK',
            items: trendingTop,
          },
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

