import { z } from 'zod';

export const searchRestaurantsSchema = z.object({
  query: z.string().trim().min(2).max(120),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});
