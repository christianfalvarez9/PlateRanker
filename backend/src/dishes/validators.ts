import { DishCategory, DishSource, DishStatus } from '@prisma/client';
import { z } from 'zod';

export const addDishSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  category: z.nativeEnum(DishCategory),
  status: z.nativeEnum(DishStatus).optional(),
  source: z.nativeEnum(DishSource).optional(),
});
