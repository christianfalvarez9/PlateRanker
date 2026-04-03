import { z } from 'zod';

const score = z.number().int().min(1).max(10);

export const createReviewSchema = z.object({
  restaurantId: z.string().uuid(),
  dishId: z.string().uuid(),
  tasteScore: score,
  portionScore: score,
  costScore: score,
  presentationScore: score,
  reviewText: z.string().trim().max(1000).optional(),
  imageUrl: z.string().url().optional(),
});

const mealDishReviewSchema = z.object({
  dishId: z.string().uuid(),
  tasteScore: score,
  portionScore: score,
  costScore: score,
  presentationScore: score,
  reviewText: z.string().trim().max(1000).optional(),
  imageUrl: z.string().url().optional(),
});

export const createMealReviewSchema = z
  .object({
    restaurantId: z.string().uuid(),
    serviceScore: score,
    atmosphereScore: score,
    valueScore: score,
    reviewText: z.string().trim().max(2000).optional(),
    imageUrl: z.string().url().optional(),
    dishes: z.array(mealDishReviewSchema).min(1).max(20),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();

    value.dishes.forEach((dish, index) => {
      if (seen.has(dish.dishId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dishes', index, 'dishId'],
          message: 'Each dish can only be reviewed once per meal review',
        });
      }

      seen.add(dish.dishId);
    });
  });
