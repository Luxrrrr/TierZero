-- The address the dashboard is opened at, so the bot can link a mod log post to its case. Filled in from the owner's requests.
ALTER TABLE "Instance" ADD COLUMN "dashboardUrl" TEXT;
