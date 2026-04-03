import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/http';
import { getUserDashboard, getUserReviews, updateRecipePreference } from './service';
import { updateRecipePreferenceSchema } from './validators';

export const usersRouter = Router();

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
