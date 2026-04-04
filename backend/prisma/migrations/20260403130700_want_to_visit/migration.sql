-- CreateTable
CREATE TABLE "WantToVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WantToVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WantToVisit_userId_restaurantId_key" ON "WantToVisit"("userId", "restaurantId");

-- CreateIndex
CREATE INDEX "WantToVisit_userId_createdAt_idx" ON "WantToVisit"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "WantToVisit"
ADD CONSTRAINT "WantToVisit_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WantToVisit"
ADD CONSTRAINT "WantToVisit_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
