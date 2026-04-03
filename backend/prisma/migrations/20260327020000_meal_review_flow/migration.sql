-- CreateTable
CREATE TABLE "MealReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "serviceScore" INTEGER NOT NULL,
    "atmosphereScore" INTEGER NOT NULL,
    "valueScore" INTEGER NOT NULL,
    "reviewText" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealReview_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Review"
ADD COLUMN "mealReviewId" TEXT;

-- CreateIndex
CREATE INDEX "MealReview_restaurantId_createdAt_idx" ON "MealReview"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "MealReview_userId_createdAt_idx" ON "MealReview"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_mealReviewId_idx" ON "Review"("mealReviewId");

-- AddForeignKey
ALTER TABLE "MealReview"
ADD CONSTRAINT "MealReview_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealReview"
ADD CONSTRAINT "MealReview_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review"
ADD CONSTRAINT "Review_mealReviewId_fkey"
FOREIGN KEY ("mealReviewId") REFERENCES "MealReview"("id")
ON DELETE SET NULL ON UPDATE CASCADE;