import { VisitSource } from '@prisma/client';
import { z } from 'zod';

export const createVisitSchema = z.object({
  restaurantId: z.string().uuid(),
  visitedAt: z.coerce.date().optional(),
  source: z.nativeEnum(VisitSource).optional(),
});
