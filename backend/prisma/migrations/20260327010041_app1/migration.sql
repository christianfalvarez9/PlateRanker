-- CreateEnum
CREATE TYPE "DishCategory" AS ENUM ('APPETIZER', 'ENTREE', 'SIDE', 'DESSERT');

-- CreateEnum
CREATE TYPE "DishStatus" AS ENUM ('ACTIVE', 'SEASONAL', 'HISTORICAL');

-- CreateEnum
CREATE TYPE "DishSource" AS ENUM ('API', 'USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('MANUAL', 'REVIEW_INFERRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "recipeMatchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "googlePlacesRef" TEXT,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "reservationUrl" TEXT,
    "overallRating" DOUBLE PRECISION,
    "foodRating" DOUBLE PRECISION,
    "serviceRating" DOUBLE PRECISION,
    "atmosphereRating" DOUBLE PRECISION,
    "valueRating" DOUBLE PRECISION,
    "highRepeatCustomersBadge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dish" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "category" "DishCategory" NOT NULL,
    "status" "DishStatus" NOT NULL DEFAULT 'ACTIVE',
    "unavailableFlagCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" "DishSource" NOT NULL DEFAULT 'API',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "tasteScore" INTEGER NOT NULL,
    "portionScore" INTEGER NOT NULL,
    "costScore" INTEGER NOT NULL,
    "presentationScore" INTEGER NOT NULL,
    "dishScore" DOUBLE PRECISION NOT NULL,
    "category" "DishCategory" NOT NULL,
    "imageUrl" TEXT,
    "reviewText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "VisitSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_googlePlacesRef_key" ON "Restaurant"("googlePlacesRef");

-- CreateIndex
CREATE INDEX "Restaurant_name_idx" ON "Restaurant"("name");

-- CreateIndex
CREATE INDEX "Dish_restaurantId_category_idx" ON "Dish"("restaurantId", "category");

-- CreateIndex
CREATE INDEX "Dish_restaurantId_status_idx" ON "Dish"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Dish_restaurantId_nameNormalized_key" ON "Dish"("restaurantId", "nameNormalized");

-- CreateIndex
CREATE INDEX "Review_restaurantId_createdAt_idx" ON "Review"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_dishId_createdAt_idx" ON "Review"("dishId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_userId_createdAt_idx" ON "Review"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Visit_restaurantId_visitedAt_idx" ON "Visit"("restaurantId", "visitedAt");

-- CreateIndex
CREATE INDEX "Visit_userId_visitedAt_idx" ON "Visit"("userId", "visitedAt");

-- AddForeignKey
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
