import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/http';
import { addDishSchema, prepopulateMenuSchema } from './validators';
import { addDish, flagDishUnavailable, prepopulateMenuFromProvider } from './service';

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

dishesRouter.post(
  '/prepopulate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = prepopulateMenuSchema.parse(req.body);
    const created = await prepopulateMenuFromProvider(input.restaurantId);
    res.status(201).json(created);
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
