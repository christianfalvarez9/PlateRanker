import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { discoveryRestaurantsSchema, searchRestaurantsSchema } from './validators';
import {
  getDishDetails,
  getLocationDiscovery,
  getRestaurantMenu,
  getRestaurantProfile,
  getRestaurantReviews,
  searchRestaurants,
} from './service';

export const restaurantsRouter = Router();

restaurantsRouter.get(
  '/discovery',
  asyncHandler(async (req, res) => {
    const input = discoveryRestaurantsSchema.parse(req.query);
    const result = await getLocationDiscovery(input);
    res.json(result);
  }),
);

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

restaurantsRouter.get(
  '/:id/menu/:dishId',
  asyncHandler(async (req, res) => {
    const result = await getDishDetails(req.params.id, req.params.dishId);
    res.json(result);
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
