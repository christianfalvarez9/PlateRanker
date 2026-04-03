import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';

type WantToVisitRestaurant = {
  id: string;
  name: string;
  address: string;
  overallRating: number | null;
  foodRating: number | null;
  highRepeatCustomersBadge: boolean;
};

type WantToVisitRecord = {
  id: string;
  createdAt: Date;
  restaurant: WantToVisitRestaurant;
};

const prismaWithWantToVisit = prisma as unknown as {
  wantToVisit: {
    findMany: (args: unknown) => Promise<WantToVisitRecord[]>;
    upsert: (args: unknown) => Promise<WantToVisitRecord>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
};

export async function getUserReviews(userId: string, requesterId: string) {
  if (userId !== requesterId) {
    throw new HttpError(403, 'Cannot view another user\'s review history');
  }

  const reviews = await prisma.review.findMany({
    where: { userId },
    include: {
      restaurant: {
        select: {
          id: true,
          name: true,
        },
      },
      dish: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return reviews;
}

export async function getUserDashboard(userId: string, requesterId: string) {
  if (userId !== requesterId) {
    throw new HttpError(403, 'Cannot view another user\'s dashboard');
  }

  const reviews = await prisma.review.findMany({
    where: { userId },
    include: {
      dish: true,
      restaurant: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const highestRatedDishes = [...reviews]
    .sort((a, b) => b.dishScore - a.dishScore)
    .slice(0, 5)
    .map((r) => ({
      reviewId: r.id,
      dishName: r.dish.name,
      restaurantName: r.restaurant.name,
      dishScore: r.dishScore,
      reviewedAt: r.createdAt,
    }));

  const restaurantMap = new Map<string, { restaurantName: string; total: number; count: number }>();
  for (const review of reviews) {
    const current = restaurantMap.get(review.restaurantId) ?? {
      restaurantName: review.restaurant.name,
      total: 0,
      count: 0,
    };
    current.total += review.dishScore;
    current.count += 1;
    restaurantMap.set(review.restaurantId, current);
  }

  const highestRatedRestaurants = [...restaurantMap.entries()]
    .map(([restaurantId, value]) => ({
      restaurantId,
      restaurantName: value.restaurantName,
      averageScore: value.total / value.count,
      reviewCount: value.count,
    }))
    .sort((a, b) => b.averageScore - a.averageScore)
    .slice(0, 5);

  const wantToVisit = await prismaWithWantToVisit.wantToVisit.findMany({
    where: { userId },
    include: {
      restaurant: {
        select: {
          id: true,
          name: true,
          address: true,
          overallRating: true,
          foodRating: true,
          highRepeatCustomersBadge: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return {
    highestRatedDishes,
    highestRatedRestaurants,
    recentReviews: reviews.slice(0, 10),
    wantToVisit: wantToVisit.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      restaurant: entry.restaurant,
    })),
  };
}

export async function updateRecipePreference(userId: string, enabled: boolean, requesterId: string) {
  if (userId !== requesterId) {
    throw new HttpError(403, 'Cannot update another user\'s preferences');
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      recipeMatchEnabled: enabled,
    },
    select: {
      id: true,
      name: true,
      email: true,
      recipeMatchEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function addWantToVisitRestaurant(userId: string, restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) {
    throw new HttpError(404, 'Restaurant not found');
  }

  const entry = await prismaWithWantToVisit.wantToVisit.upsert({
    where: {
      userId_restaurantId: {
        userId,
        restaurantId,
      },
    },
    update: {},
    create: {
      userId,
      restaurantId,
    },
    include: {
      restaurant: {
        select: {
          id: true,
          name: true,
          address: true,
          overallRating: true,
          foodRating: true,
          highRepeatCustomersBadge: true,
        },
      },
    },
  });

  return {
    id: entry.id,
    createdAt: entry.createdAt,
    restaurant: entry.restaurant,
  };
}

export async function removeWantToVisitRestaurant(userId: string, restaurantId: string) {
  await prismaWithWantToVisit.wantToVisit.deleteMany({
    where: {
      userId,
      restaurantId,
    },
  });

  return { success: true } as const;
}

export async function listWantToVisitRestaurants(userId: string) {
  const entries = await prismaWithWantToVisit.wantToVisit.findMany({
    where: { userId },
    include: {
      restaurant: {
        select: {
          id: true,
          name: true,
          address: true,
          overallRating: true,
          foodRating: true,
          highRepeatCustomersBadge: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    restaurant: entry.restaurant,
  }));
}
