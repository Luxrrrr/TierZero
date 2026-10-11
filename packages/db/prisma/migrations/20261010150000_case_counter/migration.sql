-- A per-server counter for case numbers. It starts at the highest number in
-- use, so every existing case keeps its number and the next one follows it.
ALTER TABLE "Guild" ADD COLUMN "caseCounter" INTEGER NOT NULL DEFAULT 0;
UPDATE "Guild" SET "caseCounter" = COALESCE((SELECT MAX("caseNumber") FROM "Infraction" WHERE "Infraction"."guildId" = "Guild"."id"), 0);
