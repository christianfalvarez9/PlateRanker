import { z } from 'zod';

const supportedRadiusMiles = [5, 10, 20, 50] as const;

export const searchRestaurantsSchema = z.object({
  query: z.string().trim().min(2).max(120),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radiusMiles: z
    .coerce.number()
    .int()
    .refine((value) => supportedRadiusMiles.includes(value as (typeof supportedRadiusMiles)[number]), {
      message: 'radiusMiles must be one of 5, 10, 20, or 50',
    })
    .default(5),
});
