import { z } from 'zod';

const score = z.number().int().min(1).max(10);

export const createReviewSchema = z
  .object({
    restaurantId: z.string().uuid(),
    dishId: z.string().uuid(),
    tasteScore: score,
    portionSizeScore: score.optional(),
    valueScore: score.optional(),
    portionScore: score.optional(),
    costScore: score.optional(),
    presentationScore: score,
    uniquenessScore: score.optional(),
    reviewText: z.string().trim().max(1000).optional(),
    imageUrl: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.portionSizeScore === undefined && value.portionScore === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portionSizeScore'],
        message: 'portionSizeScore is required',
      });
    }

    if (value.valueScore === undefined && value.costScore === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valueScore'],
        message: 'valueScore is required',
      });
    }
  })
  .transform((value) => ({
    restaurantId: value.restaurantId,
    dishId: value.dishId,
    tasteScore: value.tasteScore,
    portionSizeScore: value.portionSizeScore ?? (value.portionScore as number),
    valueScore: value.valueScore ?? (value.costScore as number),
    presentationScore: value.presentationScore,
    uniquenessScore: value.uniquenessScore ?? 5,
    reviewText: value.reviewText,
    imageUrl: value.imageUrl,
  }));

const mealDishReviewSchema = z
  .object({
    dishId: z.string().uuid(),
    tasteScore: score,
    portionSizeScore: score.optional(),
    valueScore: score.optional(),
    portionScore: score.optional(),
    costScore: score.optional(),
    presentationScore: score,
    uniquenessScore: score.optional(),
    reviewText: z.string().trim().max(1000).optional(),
    imageUrl: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.portionSizeScore === undefined && value.portionScore === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portionSizeScore'],
        message: 'portionSizeScore is required',
      });
    }

    if (value.valueScore === undefined && value.costScore === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valueScore'],
        message: 'valueScore is required',
      });
    }
  })
  .transform((value) => ({
    dishId: value.dishId,
    tasteScore: value.tasteScore,
    portionSizeScore: value.portionSizeScore ?? (value.portionScore as number),
    valueScore: value.valueScore ?? (value.costScore as number),
    presentationScore: value.presentationScore,
    uniquenessScore: value.uniquenessScore ?? 5,
    reviewText: value.reviewText,
    imageUrl: value.imageUrl,
  }));

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
