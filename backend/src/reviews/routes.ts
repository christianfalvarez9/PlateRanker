import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/http';
import { createMealReviewSchema, createReviewSchema, reviewIdParamSchema, updateReviewSchema } from './validators';
import { createMealReview, createReview, updateReview } from './service';

export const reviewsRouter = Router();

reviewsRouter.post(
  '/meal-reviews',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createMealReviewSchema.parse(req.body);
    const result = await createMealReview({
      userId: req.user!.id,
      ...input,
    });

    res.status(201).json(result);
  }),
);

reviewsRouter.post(
  '/reviews',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createReviewSchema.parse(req.body);
    const result = await createReview({
      userId: req.user!.id,
      ...input,
    });

    res.status(201).json(result);
  }),
);

reviewsRouter.patch(
  '/reviews/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = reviewIdParamSchema.parse(req.params);
    const input = updateReviewSchema.parse(req.body);
    const result = await updateReview({
      userId: req.user!.id,
      reviewId: id,
      ...input,
    });

    res.json(result);
  }),
);
