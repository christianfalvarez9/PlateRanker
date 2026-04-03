import { VisitSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';

export async function recalculateRepeatBadgeForRestaurant(restaurantId: string): Promise<{
  totalUsers: number;
  repeatUsers: number;
  badge: boolean;
}> {
  const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const visits = await prisma.visit.findMany({
    where: {
      restaurantId,
      visitedAt: {
        gte: windowStart,
      },
    },
    select: {
      userId: true,
    },
  });

  const counts = new Map<string, number>();
  for (const visit of visits) {
    counts.set(visit.userId, (counts.get(visit.userId) ?? 0) + 1);
  }

  const totalUsers = counts.size;
  const repeatUsers = [...counts.values()].filter((count) => count >= 2).length;
  const badge = totalUsers > 0 ? repeatUsers / totalUsers > 0.2 : false;

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      highRepeatCustomersBadge: badge,
    },
  });

  return {
    totalUsers,
    repeatUsers,
    badge,
  };
}

export async function createVisit(input: {
  userId: string;
  restaurantId: string;
  visitedAt?: Date;
  source?: VisitSource;
}) {
  const [user, restaurant] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId } }),
    prisma.restaurant.findUnique({ where: { id: input.restaurantId } }),
  ]);

  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  if (!restaurant) {
    throw new HttpError(404, 'Restaurant not found');
  }

  const visit = await prisma.visit.create({
    data: {
      userId: input.userId,
      restaurantId: input.restaurantId,
      visitedAt: input.visitedAt,
      source: input.source ?? VisitSource.MANUAL,
    },
  });

  await recalculateRepeatBadgeForRestaurant(input.restaurantId);
  return visit;
}
