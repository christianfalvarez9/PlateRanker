import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/http';
import { addDishSchema } from './validators';
import { addDish, flagDishUnavailable } from './service';

export const dishesRouter = Router();

dishesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = addDishSchema.parse(req.body);
    const dish = await addDish(input);
    res.status(201).json(dish);
  }),
);

dishesRouter.patch(
  '/:id/flag-unavailable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const dish = await flagDishUnavailable(req.params.id);
    res.json(dish);
  }),
);
