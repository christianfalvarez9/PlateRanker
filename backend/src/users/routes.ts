import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/http';
import {
  addWantToVisitRestaurant,
  getPublicUserDashboard,
  getUserDashboard,
  getUserReviews,
  listWantToVisitRestaurants,
  removeWantToVisitRestaurant,
  updateRecipePreference,
} from './service';
import {
  addWantToVisitSchema,
  updateRecipePreferenceSchema,
  wantToVisitRestaurantParamSchema,
} from './validators';

export const usersRouter = Router();

usersRouter.get(
  '/:id/dashboard/public',
  asyncHandler(async (req, res) => {
    const dashboard = await getPublicUserDashboard(req.params.id);
    res.json(dashboard);
  }),
);

usersRouter.get(
  '/:id/reviews',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reviews = await getUserReviews(req.params.id, req.user!.id);
    res.json(reviews);
  }),
);

usersRouter.get(
  '/:id/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const dashboard = await getUserDashboard(req.params.id, req.user!.id);
    res.json(dashboard);
  }),
);

usersRouter.patch(
  '/:id/preferences/recipe-match',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateRecipePreferenceSchema.parse(req.body);
    const user = await updateRecipePreference(req.params.id, input.recipeMatchEnabled, req.user!.id);
    res.json(user);
  }),
);

usersRouter.get(
  '/me/want-to-visit',
  requireAuth,
  asyncHandler(async (req, res) => {
    const entries = await listWantToVisitRestaurants(req.user!.id);
    res.json(entries);
  }),
);

usersRouter.post(
  '/me/want-to-visit',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = addWantToVisitSchema.parse(req.body);
    const entry = await addWantToVisitRestaurant(req.user!.id, input.restaurantId);
    res.status(201).json(entry);
  }),
);

usersRouter.delete(
  '/me/want-to-visit/:restaurantId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { restaurantId } = wantToVisitRestaurantParamSchema.parse(req.params);
    const result = await removeWantToVisitRestaurant(req.user!.id, restaurantId);
    res.json(result);
  }),
);
