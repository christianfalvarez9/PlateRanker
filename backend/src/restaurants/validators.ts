import { z } from 'zod';

const supportedRadiusMiles = [5, 10, 20, 50] as const;

const radiusMilesSchema = z
  .coerce.number()
  .int()
  .refine((value) => supportedRadiusMiles.includes(value as (typeof supportedRadiusMiles)[number]), {
    message: 'radiusMiles must be one of 5, 10, 20, or 50',
  })
  .default(5);

export const searchRestaurantsSchema = z.object({
  query: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radiusMiles: radiusMilesSchema,
});

export const discoveryRestaurantsSchema = z.object({
  location: z.string().trim().min(2).max(120),
  radiusMiles: radiusMilesSchema,
});
