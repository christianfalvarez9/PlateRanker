import { DishCategory, DishSource, DishStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { normalizeDishName } from '../utils/ratings';

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

  const dish = await prisma.dish.create({
    data: {
      restaurantId: input.restaurantId,
      name: input.name.trim(),
      nameNormalized: normalizeDishName(input.name),
      category: input.category,
      status: input.status ?? DishStatus.ACTIVE,
      source: input.source ?? DishSource.USER,
    },
  });

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
