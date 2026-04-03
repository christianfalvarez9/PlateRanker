import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { searchRestaurantsSchema } from './validators';
import {
  getRestaurantMenu,
  getRestaurantProfile,
  getRestaurantReviews,
  searchRestaurants,
  syncRestaurantMenuForViewing,
} from './service';

export const restaurantsRouter = Router();

restaurantsRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const input = searchRestaurantsSchema.parse(req.query);
    const results = await searchRestaurants(input);
    res.json(results);
  }),
);

restaurantsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await getRestaurantProfile(req.params.id);
    res.json(result);
  }),
);

restaurantsRouter.get(
  '/:id/menu',
  asyncHandler(async (req, res) => {
    const result = await getRestaurantMenu(req.params.id);
    res.json(result);
  }),
);

restaurantsRouter.post(
  '/:id/menu/sync',
  asyncHandler(async (req, res) => {
    const result = await syncRestaurantMenuForViewing(req.params.id);
    res.status(200).json(result);
  }),
);

restaurantsRouter.get(
  '/:id/reviews',
  asyncHandler(async (req, res) => {
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = await getRestaurantReviews(req.params.id, page, limit);
    res.json(result);
  }),
);
