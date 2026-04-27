import { VisitSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { calculateDishScore } from '../utils/ratings';
import { recomputeRestaurantRatings } from '../restaurants/ratings';
import { findRecipeMatch, RecipeMatch } from '../integrations/recipeProvider';
import { REVIEW_EDIT_WINDOW_MS } from './constants';

function normalizeOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

type CreateReviewInput = {
  userId: string;
  restaurantId: string;
  dishId: string;
  tasteScore: number;
  portionSizeScore: number;
  valueScore: number;
  presentationScore: number;
  uniquenessScore: number;
  reviewText?: string;
  imageUrl?: string;
};

type CreateMealReviewInput = {
  userId: string;
  restaurantId: string;
  serviceScore: number;
  atmosphereScore: number;
  valueScore: number;
  reviewText?: string;
  imageUrl?: string;
  dishes: Array<{
    dishId: string;
    tasteScore: number;
    portionSizeScore: number;
    valueScore: number;
    presentationScore: number;
    uniquenessScore: number;
    reviewText?: string;
    imageUrl?: string;
  }>;
};

type UpdateReviewInput = {
  userId: string;
  reviewId: string;
  tasteScore?: number;
  portionSizeScore?: number;
  valueScore?: number;
  presentationScore?: number;
  uniquenessScore?: number;
  reviewText?: string | null;
  imageUrl?: string | null;
};

type ReviewWithRelations = Awaited<ReturnType<typeof prisma.review.create>>;

async function upsertSavedRecipe(args: {
  userId: string;
  restaurantId: string;
  dishId: string;
  recipe: RecipeMatch;
}): Promise<void> {
  await prisma.savedRecipe.upsert({
    where: {
      userId_dishId_link: {
        userId: args.userId,
        dishId: args.dishId,
        link: args.recipe.link,
      },
    },
    update: {
      title: args.recipe.title,
      restaurantId: args.restaurantId,
    },
    create: {
      userId: args.userId,
      restaurantId: args.restaurantId,
      dishId: args.dishId,
      title: args.recipe.title,
      link: args.recipe.link,
    },
  });
}

export async function createReview(
  input: CreateReviewInput,
): Promise<{ review: ReviewWithRelations; recipeMatch: RecipeMatch | null }> {
  const dish = await prisma.dish.findUnique({
    where: { id: input.dishId },
    include: {
      restaurant: true,
    },
  });

  if (!dish || dish.restaurantId !== input.restaurantId) {
    throw new HttpError(400, 'Dish does not belong to restaurant');
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const duplicate = await prisma.review.findFirst({
    where: {
      userId: input.userId,
      dishId: input.dishId,
      createdAt: {
        gte: fifteenMinutesAgo,
      },
    },
  });

  if (duplicate) {
    throw new HttpError(429, 'Please wait before submitting another review for the same dish');
  }

  const dishScore = calculateDishScore({
    tasteScore: input.tasteScore,
    portionSizeScore: input.portionSizeScore,
    valueScore: input.valueScore,
    presentationScore: input.presentationScore,
    uniquenessScore: input.uniquenessScore,
  });

  const review = await prisma.review.create({
    data: {
      userId: input.userId,
      restaurantId: input.restaurantId,
      dishId: input.dishId,
      tasteScore: input.tasteScore,
      portionSizeScore: input.portionSizeScore,
      valueScore: input.valueScore,
      presentationScore: input.presentationScore,
      uniquenessScore: input.uniquenessScore,
      dishScore,
      category: dish.category,
      reviewText: normalizeOptionalText(input.reviewText),
      imageUrl: input.imageUrl,
    },
    include: {
      dish: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          recipeMatchEnabled: true,
        },
      },
    },
  });

  await prisma.visit.create({
    data: {
      userId: input.userId,
      restaurantId: input.restaurantId,
      source: VisitSource.REVIEW_INFERRED,
    },
  });

  await recomputeRestaurantRatings(input.restaurantId);

  let recipeMatch: RecipeMatch | null = null;
  if (dishScore >= 8 && user.recipeMatchEnabled) {
    recipeMatch = await findRecipeMatch(dish.name);

    if (recipeMatch) {
      await upsertSavedRecipe({
        userId: input.userId,
        restaurantId: input.restaurantId,
        dishId: dish.id,
        recipe: recipeMatch,
      });
    }
  }

  return {
    review,
    recipeMatch,
  };
}

export async function createMealReview(input: CreateMealReviewInput): Promise<{
  mealReview: {
    id: string;
    serviceScore: number;
    atmosphereScore: number;
    valueScore: number;
    reviewText: string | null;
    imageUrl: string | null;
    createdAt: Date;
    dishReviews: Array<{
      id: string;
      dishId: string;
      dishScore: number;
      tasteScore: number;
      portionSizeScore: number;
      valueScore: number;
      presentationScore: number;
      uniquenessScore: number;
      reviewText: string | null;
      imageUrl: string | null;
      createdAt: Date;
      dish: {
        id: string;
        name: string;
        category: string;
      };
    }>;
  };
  recipeMatches: RecipeMatch[];
}> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: input.restaurantId } });
  if (!restaurant) {
    throw new HttpError(404, 'Restaurant not found');
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const dishIds = input.dishes.map((dish) => dish.dishId);
  const dishes = await prisma.dish.findMany({
    where: {
      id: { in: dishIds },
      restaurantId: input.restaurantId,
    },
  });

  if (dishes.length !== dishIds.length) {
    throw new HttpError(400, 'One or more dishes do not belong to this restaurant');
  }

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const duplicate = await prisma.mealReview.findFirst({
    where: {
      userId: input.userId,
      restaurantId: input.restaurantId,
      createdAt: {
        gte: fifteenMinutesAgo,
      },
    },
  });

  if (duplicate) {
    throw new HttpError(429, 'Please wait before submitting another meal review for this restaurant');
  }

  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));

  const created = await prisma.$transaction(async (tx) => {
    const mealReview = await tx.mealReview.create({
      data: {
        userId: input.userId,
        restaurantId: input.restaurantId,
        serviceScore: input.serviceScore,
        atmosphereScore: input.atmosphereScore,
        valueScore: input.valueScore,
        reviewText: normalizeOptionalText(input.reviewText),
        imageUrl: input.imageUrl,
      },
    });

    const dishReviews = [] as Awaited<ReturnType<typeof tx.review.create>>[];
    for (const dishInput of input.dishes) {
      const dish = dishById.get(dishInput.dishId);
      if (!dish) {
        throw new HttpError(400, 'Dish does not belong to restaurant');
      }

      const dishScore = calculateDishScore({
        tasteScore: dishInput.tasteScore,
        portionSizeScore: dishInput.portionSizeScore,
        valueScore: dishInput.valueScore,
        presentationScore: dishInput.presentationScore,
        uniquenessScore: dishInput.uniquenessScore,
      });

      const review = await tx.review.create({
        data: {
          mealReviewId: mealReview.id,
          userId: input.userId,
          restaurantId: input.restaurantId,
          dishId: dishInput.dishId,
          tasteScore: dishInput.tasteScore,
          portionSizeScore: dishInput.portionSizeScore,
          valueScore: dishInput.valueScore,
          presentationScore: dishInput.presentationScore,
          uniquenessScore: dishInput.uniquenessScore,
          dishScore,
          category: dish.category,
          reviewText: normalizeOptionalText(dishInput.reviewText),
          imageUrl: dishInput.imageUrl,
        },
      });

      dishReviews.push(review);
    }

    await tx.visit.create({
      data: {
        userId: input.userId,
        restaurantId: input.restaurantId,
        source: VisitSource.REVIEW_INFERRED,
      },
    });

    return {
      mealReview,
      dishReviews,
    };
  });

  await recomputeRestaurantRatings(input.restaurantId);

  let recipeMatches: RecipeMatch[] = [];
  if (user.recipeMatchEnabled) {
    const matched = await Promise.all(
      created.dishReviews
        .filter((review) => review.dishScore >= 8)
        .map(async (review) => {
          const dish = dishById.get(review.dishId);
          if (!dish) {
            return null;
          }

          const recipe = await findRecipeMatch(dish.name);
          if (!recipe) {
            return null;
          }

          await upsertSavedRecipe({
            userId: input.userId,
            restaurantId: input.restaurantId,
            dishId: dish.id,
            recipe,
          });

          return recipe;
        }),
    );

    const uniqueByLink = new Map<string, RecipeMatch>();
    for (const recipe of matched.filter((item): item is RecipeMatch => item !== null)) {
      if (!uniqueByLink.has(recipe.link)) {
        uniqueByLink.set(recipe.link, recipe);
      }
    }

    recipeMatches = Array.from(uniqueByLink.values());
  }

  const mealReviewWithDishReviews = await prisma.mealReview.findUniqueOrThrow({
    where: { id: created.mealReview.id },
    include: {
      dishReviews: {
        include: {
          dish: {
            select: {
              id: true,
              name: true,
              category: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  return {
    mealReview: mealReviewWithDishReviews,
    recipeMatches,
  };
}

export async function updateReview(input: UpdateReviewInput) {
  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
  });

  if (!review) {
    throw new HttpError(404, 'Review not found');
  }

  if (review.userId !== input.userId) {
    throw new HttpError(403, 'Cannot edit another user\'s review');
  }

  const editDeadline = new Date(review.createdAt.getTime() + REVIEW_EDIT_WINDOW_MS);
  if (Date.now() > editDeadline.getTime()) {
    throw new HttpError(403, 'This review can no longer be edited (24-hour window expired)');
  }

  const nextTasteScore = input.tasteScore ?? review.tasteScore;
  const nextPortionSizeScore = input.portionSizeScore ?? review.portionSizeScore;
  const nextValueScore = input.valueScore ?? review.valueScore;
  const nextPresentationScore = input.presentationScore ?? review.presentationScore;
  const nextUniquenessScore = input.uniquenessScore ?? review.uniquenessScore;

  const nextDishScore = calculateDishScore({
    tasteScore: nextTasteScore,
    portionSizeScore: nextPortionSizeScore,
    valueScore: nextValueScore,
    presentationScore: nextPresentationScore,
    uniquenessScore: nextUniquenessScore,
  });

  const updatedReview = await prisma.review.update({
    where: { id: review.id },
    data: {
      tasteScore: input.tasteScore,
      portionSizeScore: input.portionSizeScore,
      valueScore: input.valueScore,
      presentationScore: input.presentationScore,
      uniquenessScore: input.uniquenessScore,
      dishScore: nextDishScore,
      reviewText: input.reviewText === undefined ? undefined : normalizeOptionalText(input.reviewText ?? undefined) ?? null,
      imageUrl: input.imageUrl === undefined ? undefined : input.imageUrl,
    },
    include: {
      dish: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
      restaurant: {
        select: {
          id: true,
          name: true,
        },
      },
      mealReview: {
        select: {
          id: true,
          serviceScore: true,
          atmosphereScore: true,
          valueScore: true,
          reviewText: true,
          createdAt: true,
        },
      },
    },
  });

  await recomputeRestaurantRatings(review.restaurantId);

  const editableUntil = new Date(updatedReview.createdAt.getTime() + REVIEW_EDIT_WINDOW_MS);

  return {
    ...updatedReview,
    editableUntil,
    canEdit: Date.now() <= editableUntil.getTime(),
  };
}
