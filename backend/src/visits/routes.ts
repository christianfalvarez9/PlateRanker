import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/http';
import { createVisitSchema } from './validators';
import { createVisit } from './service';

export const visitsRouter = Router();

visitsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createVisitSchema.parse(req.body);
    const visit = await createVisit({
      userId: req.user!.id,
      restaurantId: input.restaurantId,
      visitedAt: input.visitedAt,
      source: input.source,
    });
    res.status(201).json(visit);
  }),
);
