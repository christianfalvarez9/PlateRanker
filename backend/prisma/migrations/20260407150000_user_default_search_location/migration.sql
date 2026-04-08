-- Add nullable default search location for user profile personalization
ALTER TABLE "User"
ADD COLUMN "defaultSearchLocation" TEXT;
