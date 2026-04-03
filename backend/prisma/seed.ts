import bcrypt from 'bcryptjs';
import { DishCategory, DishSource, DishStatus, Prisma, VisitSource } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { calculateDishScore } from '../src/utils/ratings';
import { recomputeRestaurantRatings } from '../src/restaurants/ratings';
import { recalculateRepeatBadgeForRestaurant } from '../src/visits/service';

async function main() {
  if ('mealReview' in prisma) {
    await (prisma as unknown as { mealReview: { deleteMany: () => Promise<unknown> } }).mealReview.deleteMany();
  }
  await prisma.review.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const [alice, bob, cara] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Alice Johnson',
        email: 'alice@example.com',
        passwordHash,
        recipeMatchEnabled: true,
      },
    }),
    prisma.user.create({
      data: {
        name: 'Bob Lee',
        email: 'bob@example.com',
        passwordHash,
        recipeMatchEnabled: true,
      },
    }),
    prisma.user.create({
      data: {
        name: 'Cara Smith',
        email: 'cara@example.com',
        passwordHash,
        recipeMatchEnabled: false,
      },
    }),
  ]);

  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Demo Bistro',
      googlePlacesRef: 'demo-bistro-001',
      address: '123 Main St, Demo City',
      phone: '(555) 111-2222',
      website: 'https://example.com',
    },
  });

  const dishes = await Promise.all([
    prisma.dish.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Garlic Bread',
        nameNormalized: 'garlic bread',
        category: DishCategory.APPETIZER,
        source: DishSource.API,
        status: DishStatus.ACTIVE,
      },
    }),
    prisma.dish.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Steak Frites',
        nameNormalized: 'steak frites',
        category: DishCategory.ENTREE,
        source: DishSource.API,
        status: DishStatus.ACTIVE,
      },
    }),
    prisma.dish.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Roasted Potatoes',
        nameNormalized: 'roasted potatoes',
        category: DishCategory.SIDE,
        source: DishSource.API,
        status: DishStatus.ACTIVE,
      },
    }),
    prisma.dish.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Lemon Tart',
        nameNormalized: 'lemon tart',
        category: DishCategory.DESSERT,
        source: DishSource.API,
        status: DishStatus.SEASONAL,
      },
    }),
  ]);

  const reviewPayloads = [
    {
      userId: alice.id,
      dish: dishes[0],
      serviceScore: 8,
      atmosphereScore: 7,
      valueScore: 8,
      tasteScore: 8,
      portionScore: 7,
      costScore: 8,
      presentationScore: 7,
    },
    {
      userId: bob.id,
      dish: dishes[1],
      serviceScore: 9,
      atmosphereScore: 8,
      valueScore: 8,
      tasteScore: 9,
      portionScore: 8,
      costScore: 8,
      presentationScore: 8,
    },
    {
      userId: cara.id,
      dish: dishes[2],
      serviceScore: 7,
      atmosphereScore: 7,
      valueScore: 7,
      tasteScore: 7,
      portionScore: 8,
      costScore: 7,
      presentationScore: 7,
    },
    {
      userId: alice.id,
      dish: dishes[3],
      serviceScore: 9,
      atmosphereScore: 8,
      valueScore: 8,
      tasteScore: 9,
      portionScore: 8,
      costScore: 7,
      presentationScore: 9,
    },
  ];

  for (const payload of reviewPayloads) {
    const dishScore = calculateDishScore({
      tasteScore: payload.tasteScore,
      portionScore: payload.portionScore,
      costScore: payload.costScore,
      presentationScore: payload.presentationScore,
    });
    let mealReviewId: string | null = null;

    if ('mealReview' in prisma) {
      const createdMealReview = await (
        prisma as unknown as {
          mealReview: {
            create: (args: {
              data: {
                userId: string;
                restaurantId: string;
                serviceScore: number;
                atmosphereScore: number;
                valueScore: number;
              };
            }) => Promise<{ id: string }>;
          };
        }
      ).mealReview.create({
        data: {
          userId: payload.userId,
          restaurantId: restaurant.id,
          serviceScore: payload.serviceScore,
          atmosphereScore: payload.atmosphereScore,
          valueScore: payload.valueScore,
        },
      });

      mealReviewId = createdMealReview.id;
    }

    const reviewData: Prisma.ReviewUncheckedCreateInput = {
      userId: payload.userId,
      restaurantId: restaurant.id,
      dishId: payload.dish.id,
      tasteScore: payload.tasteScore,
      portionScore: payload.portionScore,
      costScore: payload.costScore,
      presentationScore: payload.presentationScore,
      dishScore,
      category: payload.dish.category,
      ...(mealReviewId ? ({ mealReviewId } as { mealReviewId: string }) : {}),
    };

    await prisma.review.create({
      data: reviewData,
    });
  }

  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  await prisma.visit.createMany({
    data: [
      { userId: alice.id, restaurantId: restaurant.id, visitedAt: daysAgo(10), source: VisitSource.MANUAL },
      { userId: alice.id, restaurantId: restaurant.id, visitedAt: daysAgo(5), source: VisitSource.MANUAL },
      { userId: bob.id, restaurantId: restaurant.id, visitedAt: daysAgo(8), source: VisitSource.REVIEW_INFERRED },
      { userId: bob.id, restaurantId: restaurant.id, visitedAt: daysAgo(3), source: VisitSource.REVIEW_INFERRED },
      { userId: cara.id, restaurantId: restaurant.id, visitedAt: daysAgo(1), source: VisitSource.MANUAL },
    ],
  });

  await recomputeRestaurantRatings(restaurant.id);
  await recalculateRepeatBadgeForRestaurant(restaurant.id);

  console.log('Seed complete.');
  console.log('Demo users: alice@example.com / Password123!, bob@example.com / Password123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
