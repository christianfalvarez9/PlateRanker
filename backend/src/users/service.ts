import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';

async function listDashboardReviews(userId: string) {
  return prisma.review.findMany({
    where: { userId },
    include: {
      dish: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
      restaurant: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

function buildDashboardInsights(reviews: Awaited<ReturnType<typeof listDashboardReviews>>) {
  const highestRatedDishes = [...reviews]
    .sort((a, b) => b.dishScore - a.dishScore)
    .slice(0, 5)
    .map((review) => ({
      reviewId: review.id,
      dishName: review.dish.name,
      restaurantName: review.restaurant.name,
      dishScore: review.dishScore,
      reviewedAt: review.createdAt,
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

  const recentReviews = reviews.slice(0, 10).map((review) => ({
    id: review.id,
    dishScore: review.dishScore,
    dish: {
      name: review.dish.name,
    },
    restaurant: {
      name: review.restaurant.name,
    },
    createdAt: review.createdAt,
  }));

  return {
    highestRatedDishes,
    highestRatedRestaurants,
    recentReviews,
  };
}

export async function getUserReviews(userId: string, requesterId: string) {
  if (userId !== requesterId) {
    throw new HttpError(403, 'Cannot view another user\'s review history');
  }

  const reviews = await prisma.review.findMany({
    where: { userId },
    include: {
      mealReview: {
        select: {
          id: true,
          serviceScore: true,
          atmosphereScore: true,
          valueScore: true,
          reviewText: true,
          createdAt: true,
        },
      },
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

  const reviews = await listDashboardReviews(userId);
  const insights = buildDashboardInsights(reviews);

  const wantToVisit = await prisma.wantToVisit.findMany({
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

  const savedRecipes = await prisma.savedRecipe.findMany({
    where: { userId },
    include: {
      dish: {
        select: {
          id: true,
          name: true,
        },
      },
      restaurant: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 30,
  });

  return {
    ...insights,
    wantToVisit: wantToVisit.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      restaurant: entry.restaurant,
    })),
    savedRecipes: savedRecipes.map((entry) => ({
      id: entry.id,
      title: entry.title,
      link: entry.link,
      createdAt: entry.createdAt,
      dish: entry.dish,
      restaurant: entry.restaurant,
    })),
  };
}

export async function getPublicUserDashboard(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const reviews = await listDashboardReviews(userId);
  const insights = buildDashboardInsights(reviews);

  return {
    user,
    ...insights,
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

export async function getDefaultSearchLocation(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      defaultSearchLocation: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  return {
    defaultSearchLocation: user.defaultSearchLocation,
    updatedAt: user.updatedAt,
  };
}

export async function updateDefaultSearchLocation(userId: string, defaultSearchLocation: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      defaultSearchLocation,
    },
    select: {
      id: true,
      name: true,
      email: true,
      defaultSearchLocation: true,
      recipeMatchEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
}

export async function removeDefaultSearchLocation(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      defaultSearchLocation: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      defaultSearchLocation: true,
      recipeMatchEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
}

export async function addWantToVisitRestaurant(userId: string, restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) {
    throw new HttpError(404, 'Restaurant not found');
  }

  const entry = await prisma.wantToVisit.upsert({
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
  await prisma.wantToVisit.deleteMany({
    where: {
      userId,
      restaurantId,
    },
  });

  return { success: true } as const;
}

export async function listWantToVisitRestaurants(userId: string) {
  const entries = await prisma.wantToVisit.findMany({
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
