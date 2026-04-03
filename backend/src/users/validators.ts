import { z } from 'zod';

export const updateRecipePreferenceSchema = z.object({
  recipeMatchEnabled: z.boolean(),
});

export const addWantToVisitSchema = z.object({
  restaurantId: z.string().uuid(),
});

export const wantToVisitRestaurantParamSchema = z.object({
  restaurantId: z.string().uuid(),
});
