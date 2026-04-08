-- Add uniqueness score for new dish scoring criterion.
ALTER TABLE "Review"
ADD COLUMN "uniquenessScore" INTEGER NOT NULL DEFAULT 5;
