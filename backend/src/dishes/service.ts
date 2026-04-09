import { DishCategory, DishSource, DishStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { normalizeDishName } from '../utils/ratings';
import { findSimilarDishName } from '../utils/dishNameSimilarity';
import { findBlockedTermInDishName } from '../utils/menuNameModeration';

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

  const trimmedName = input.name.trim();
  const blockedTerm = findBlockedTermInDishName(trimmedName);
  if (blockedTerm) {
    throw new HttpError(400, 'Plate name contains inappropriate language');
  }

  const normalizedName = normalizeDishName(trimmedName);

  const existingDishes = await prisma.dish.findMany({
    where: {
      restaurantId: input.restaurantId,
    },
    select: {
      name: true,
      nameNormalized: true,
    },
  });

  const exactMatch = existingDishes.find((dish) => dish.nameNormalized === normalizedName);
  if (exactMatch) {
    throw new HttpError(409, `A similar plate already exists: ${exactMatch.name}`);
  }

  const similarMatch = findSimilarDishName(
    trimmedName,
    existingDishes.map((dish) => dish.name),
  );

  if (similarMatch) {
    throw new HttpError(409, `A similar plate already exists: ${similarMatch.existingName}`);
  }

  let dish;
  try {
    dish = await prisma.dish.create({
      data: {
        restaurantId: input.restaurantId,
        name: trimmedName,
        nameNormalized: normalizedName,
        category: input.category,
        status: input.status ?? DishStatus.ACTIVE,
        source: input.source ?? DishSource.USER,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new HttpError(409, 'A plate with this name already exists on this menu');
    }

    throw error;
  }

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

export async function moveDishToHistorical(dishId: string) {
  const dish = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!dish) {
    throw new HttpError(404, 'Dish not found');
  }

  if (dish.status === DishStatus.HISTORICAL && dish.isActive === false) {
    return dish;
  }

  const updated = await prisma.dish.update({
    where: { id: dishId },
    data: {
      status: DishStatus.HISTORICAL,
      isActive: false,
    },
  });

  return updated;
}

export async function permanentlyDeleteHistoricalDish(dishId: string) {
  const dish = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!dish) {
    throw new HttpError(404, 'Dish not found');
  }

  if (dish.status !== DishStatus.HISTORICAL) {
    throw new HttpError(400, 'Dish must be moved to historical before permanent deletion');
  }

  await prisma.dish.delete({ where: { id: dishId } });

  return { success: true } as const;
}
