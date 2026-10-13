-- Whether the dashboard may ask GitHub for new releases and the roadmap. On unless the owner turns it off.
ALTER TABLE "Instance" ADD COLUMN "updateChecks" BOOLEAN NOT NULL DEFAULT true;
