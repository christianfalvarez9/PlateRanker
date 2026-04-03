import { DishStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { searchGooglePlaces } from '../integrations/googlePlaces';
import { syncRestaurantMenu, type MenuSyncResult } from '../dishes/service';

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarizeDishReviews(input: {
  reviewCount: number;
  avgDishScore: number | null;
  avgTaste: number | null;
  avgPortion: number | null;
  avgCost: number | null;
  avgPresentation: number | null;
  reviewTexts: string[];
}): string {
  if (!input.reviewCount) {
    return 'No reviews yet for this dish.';
  }

  const criteria = [
    { label: 'taste', value: input.avgTaste ?? 0 },
    { label: 'portion', value: input.avgPortion ?? 0 },
    { label: 'cost', value: input.avgCost ?? 0 },
    { label: 'presentation', value: input.avgPresentation ?? 0 },
  ].sort((a, b) => b.value - a.value);

  const strongest = criteria[0];
  const weakest = criteria[criteria.length - 1];
  const overall = input.avgDishScore ?? 0;
  const reviewSignal =
    input.reviewTexts.find((text) => text.length >= 20)?.slice(0, 180) ??
    'Users are still adding detailed notes for this dish.';

  return `${input.reviewCount} review${input.reviewCount === 1 ? '' : 's'} average ${roundToTwo(
    overall,
  )}/10. Strongest feedback is ${strongest.label} (${roundToTwo(
    strongest.value,
  )}/10), while ${weakest.label} is comparatively lower (${roundToTwo(
    weakest.value,
  )}/10). Common sentiment: ${reviewSignal}`;
}

export async function searchRestaurants(args: { query: string; lat?: number; lng?: number }) {
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

      return restaurant;
    }),
  );

  return records;
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

  const [aggregates, recentReviews] = await Promise.all([
    prisma.review.aggregate({
      where: { dishId },
      _avg: {
        dishScore: true,
        tasteScore: true,
        portionScore: true,
        costScore: true,
        presentationScore: true,
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
        portionScore: true,
        costScore: true,
        presentationScore: true,
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
  ]);

  const reviewTexts = recentReviews
    .map((review) => review.reviewText?.trim() ?? '')
    .filter((text) => Boolean(text));

  const photoUrls = Array.from(
    new Set(recentReviews.map((review) => review.imageUrl ?? '').filter((url) => Boolean(url))),
  );

  return {
    dish,
    aggregates: {
      reviewCount: aggregates._count._all,
      avgDishScore: aggregates._avg.dishScore,
      avgTaste: aggregates._avg.tasteScore,
      avgPortion: aggregates._avg.portionScore,
      avgCost: aggregates._avg.costScore,
      avgPresentation: aggregates._avg.presentationScore,
    },
    summary: summarizeDishReviews({
      reviewCount: aggregates._count._all,
      avgDishScore: aggregates._avg.dishScore,
      avgTaste: aggregates._avg.tasteScore,
      avgPortion: aggregates._avg.portionScore,
      avgCost: aggregates._avg.costScore,
      avgPresentation: aggregates._avg.presentationScore,
      reviewTexts,
    }),
    photos: photoUrls,
    recentReviews,
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
