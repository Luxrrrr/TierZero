-- AlterTable
ALTER TABLE "Instance" ADD COLUMN "botStatus" TEXT NOT NULL DEFAULT 'online';
ALTER TABLE "Instance" ADD COLUMN "botActivityType" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Instance" ADD COLUMN "botActivityText" TEXT NOT NULL DEFAULT '';
