import { DishCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { calculateFoodRating, calculateOverallRating, roundToTwo } from '../utils/ratings';

export async function recomputeRestaurantRatings(restaurantId: string): Promise<void> {
  const grouped = await prisma.review.groupBy({
    by: ['category'],
    where: { restaurantId },
    _avg: {
      dishScore: true,
    },
  });

  const categoryAverages: Partial<Record<DishCategory, number>> = {};
  for (const group of grouped) {
    if (group._avg.dishScore !== null) {
      categoryAverages[group.category] = roundToTwo(group._avg.dishScore);
    }
  }

  const experienceAverages = await prisma.mealReview.aggregate({
    where: { restaurantId },
    _avg: {
      serviceScore: true,
      atmosphereScore: true,
      beverageScore: true,
    },
  });

  const foodRating = calculateFoodRating(categoryAverages);
  const serviceRating =
    experienceAverages._avg.serviceScore === null
      ? null
      : roundToTwo(experienceAverages._avg.serviceScore);
  const atmosphereRating =
    experienceAverages._avg.atmosphereScore === null
      ? null
      : roundToTwo(experienceAverages._avg.atmosphereScore);
  const beverageRating =
    experienceAverages._avg.beverageScore === null
      ? null
      : roundToTwo(experienceAverages._avg.beverageScore);

  const overallRating = calculateOverallRating({
    foodRating,
    serviceRating,
    atmosphereRating,
    beverageRating,
  });

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      foodRating,
      serviceRating,
      atmosphereRating,
      beverageRating,
      overallRating,
    },
  });
}
