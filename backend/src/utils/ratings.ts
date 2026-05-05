import { DishCategory } from '@prisma/client';

type DishScoreInput = {
  tasteScore: number;
  portionSizeScore: number;
  valueScore: number;
  presentationScore: number;
  uniquenessScore: number;
};

const CATEGORY_WEIGHTS: Record<DishCategory, number> = {
  APPETIZER: 0.2,
  SALAD_SOUP: 0.15,
  ENTREE: 0.4,
  SIDE: 0.15,
  DESSERT: 0.1,
};

export function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateDishScore(input: DishScoreInput): number {
  const total =
    input.tasteScore * 0.6 +
    input.portionSizeScore * 0.15 +
    input.valueScore * 0.15 +
    input.presentationScore * 0.05 +
    input.uniquenessScore * 0.05;

  return roundToTwo(total);
}

export function calculateFoodRating(categoryAverages: Partial<Record<DishCategory, number>>): number | null {
  const entries = Object.entries(CATEGORY_WEIGHTS)
    .map(([category, weight]) => ({
      category: category as DishCategory,
      weight,
      score: categoryAverages[category as DishCategory],
    }))
    .filter((entry) => typeof entry.score === 'number');

  if (!entries.length) {
    return null;
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const weighted = entries.reduce((sum, entry) => {
    const normalizedWeight = entry.weight / totalWeight;
    return sum + (entry.score as number) * normalizedWeight;
  }, 0);

  return roundToTwo(weighted);
}

export function calculateOverallRating(args: {
  foodRating: number | null;
  serviceRating: number | null;
  atmosphereRating: number | null;
  beverageRating: number | null;
}): number | null {
  const { foodRating, serviceRating, atmosphereRating, beverageRating } = args;

  if (foodRating === null) {
    return null;
  }

  if (serviceRating === null || atmosphereRating === null || beverageRating === null) {
    return foodRating;
  }

  const total =
    foodRating * 0.5 + serviceRating * 0.2 + atmosphereRating * 0.15 + beverageRating * 0.15;
  return roundToTwo(total);
}

export function normalizeDishName(name: string): string {
  return name.trim().toLowerCase();
}
