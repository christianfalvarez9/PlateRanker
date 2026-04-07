import { z } from 'zod';

export const updateRecipePreferenceSchema = z.object({
  recipeMatchEnabled: z.boolean(),
});

export const updateDefaultSearchLocationSchema = z.object({
  defaultSearchLocation: z.string().trim().min(2).max(120),
});

export const addWantToVisitSchema = z.object({
  restaurantId: z.string().uuid(),
});

export const wantToVisitRestaurantParamSchema = z.object({
  restaurantId: z.string().uuid(),
});
