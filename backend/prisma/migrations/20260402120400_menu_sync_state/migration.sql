-- CreateTable
CREATE TABLE "MenuSyncState" (
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "nextAllowedAt" TIMESTAMP(3),
    "lastPayloadHash" TEXT,
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuSyncState_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateIndex
CREATE INDEX "MenuSyncState_provider_idx" ON "MenuSyncState"("provider");

-- CreateIndex
CREATE INDEX "MenuSyncState_nextAllowedAt_idx" ON "MenuSyncState"("nextAllowedAt");

-- AddForeignKey
ALTER TABLE "MenuSyncState"
ADD CONSTRAINT "MenuSyncState_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;