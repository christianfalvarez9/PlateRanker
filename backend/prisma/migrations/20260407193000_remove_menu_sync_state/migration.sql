-- DropForeignKey
ALTER TABLE "MenuSyncState" DROP CONSTRAINT IF EXISTS "MenuSyncState_restaurantId_fkey";

-- DropTable
DROP TABLE IF EXISTS "MenuSyncState";