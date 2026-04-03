import { z } from 'zod';

export const updateRecipePreferenceSchema = z.object({
  recipeMatchEnabled: z.boolean(),
});
