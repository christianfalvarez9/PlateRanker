-- CreateTable
CREATE TABLE "SavedRecipe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedRecipe_userId_dishId_link_key" ON "SavedRecipe"("userId", "dishId", "link");

-- CreateIndex
CREATE INDEX "SavedRecipe_userId_createdAt_idx" ON "SavedRecipe"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedRecipe_dishId_idx" ON "SavedRecipe"("dishId");

-- AddForeignKey
ALTER TABLE "SavedRecipe"
ADD CONSTRAINT "SavedRecipe_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedRecipe"
ADD CONSTRAINT "SavedRecipe_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedRecipe"
ADD CONSTRAINT "SavedRecipe_dishId_fkey"
FOREIGN KEY ("dishId") REFERENCES "Dish"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
