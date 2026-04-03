import { DishStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { searchGooglePlaces } from '../integrations/googlePlaces';
import { syncRestaurantMenu, type MenuSyncResult } from '../dishes/service';

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

  return {
    restaurant,
    topDishes: sortedDesc.slice(0, 3),
    bottomDishes: sortedAsc.slice(0, 3),
    menu: {
      activeAndSeasonal: restaurant.dishes.filter((d) => d.status !== DishStatus.HISTORICAL),
      historical: restaurant.dishes.filter((d) => d.status === DishStatus.HISTORICAL),
    },
  };
}

export async function getRestaurantMenu(restaurantId: string) {
  const dishes = await prisma.dish.findMany({
    where: { restaurantId },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });

  return dishes;
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
