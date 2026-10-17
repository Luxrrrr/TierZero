-- Per-server ticket numbers, who answered first, why a transcript is empty,
-- and whether the opener left. Every statement only fills what is still empty,
-- so running the backfill twice changes nothing.
ALTER TABLE "Ticket" ADD COLUMN "number" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "firstResponderId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "transcriptDeletedAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "transcriptDeletedById" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "transcriptDeletedByName" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "messagesPrunedAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "openerLeftAt" DATETIME;
ALTER TABLE "TicketPanelPost" ADD COLUMN "hash" TEXT NOT NULL DEFAULT '';

-- Existing tickets are numbered in the order they were opened, per server.
UPDATE "Ticket" SET "number" = (
  SELECT COUNT(*) FROM "Ticket" AS "earlier"
  WHERE "earlier"."guildId" = "Ticket"."guildId" AND "earlier"."id" <= "Ticket"."id"
)
WHERE "number" IS NULL;

CREATE UNIQUE INDEX "Ticket_guildId_number_key" ON "Ticket"("guildId", "number");

-- The first answer from someone other than the opener, from the stored messages.
-- A dashboard reply through a webhook is stored as a bot but was a person.
UPDATE "Ticket" SET "firstResponderId" = (
  SELECT "m"."authorId" FROM "TicketMessage" AS "m"
  WHERE "m"."ticketId" = "Ticket"."id"
    AND "m"."authorId" <> "Ticket"."openerId"
    AND ("m"."authorBot" = 0 OR "m"."source" = 'dashboard')
  ORDER BY "m"."createdAt", "m"."id"
  LIMIT 1
)
WHERE "firstResponseAt" IS NOT NULL AND "firstResponderId" IS NULL;

-- A transcript deleted before this was recorded on the ticket keeps its audit row; copy who and when.
UPDATE "Ticket" SET
  "transcriptDeletedAt" = (
    SELECT "a"."createdAt" FROM "TicketAudit" AS "a"
    WHERE "a"."ticketId" = "Ticket"."id" AND "a"."guildId" = "Ticket"."guildId" AND "a"."kind" = 'transcript.delete'
    ORDER BY "a"."id" DESC LIMIT 1
  ),
  "transcriptDeletedById" = (
    SELECT "a"."actorId" FROM "TicketAudit" AS "a"
    WHERE "a"."ticketId" = "Ticket"."id" AND "a"."guildId" = "Ticket"."guildId" AND "a"."kind" = 'transcript.delete'
    ORDER BY "a"."id" DESC LIMIT 1
  ),
  "transcriptDeletedByName" = (
    SELECT "a"."actorName" FROM "TicketAudit" AS "a"
    WHERE "a"."ticketId" = "Ticket"."id" AND "a"."guildId" = "Ticket"."guildId" AND "a"."kind" = 'transcript.delete'
    ORDER BY "a"."id" DESC LIMIT 1
  )
WHERE "transcriptDeletedAt" IS NULL AND EXISTS (
  SELECT 1 FROM "TicketAudit" AS "a"
  WHERE "a"."ticketId" = "Ticket"."id" AND "a"."guildId" = "Ticket"."guildId" AND "a"."kind" = 'transcript.delete'
);

-- The version before panels were tracked posted its one panel without noting
-- where. A server that really used it, shown by its old panel setting or by a
-- ticket the tickets overhaul migration gave the panel 'default', gets a row with no message id, so
-- the dashboard can say the old message may still be up. A new server gets none.
INSERT INTO "TicketPanelPost" ("guildId", "panelId", "channelId", "messageId", "postedAt", "hash")
SELECT
  "gm"."guildId",
  'default',
  COALESCE(
    CASE WHEN json_valid("gm"."settings") THEN json_extract("gm"."settings", '$.panel.channel') END,
    CASE WHEN json_valid("gm"."settings") THEN (
      SELECT json_extract("p"."value", '$.channel') FROM json_each("gm"."settings", '$.panels') AS "p"
      WHERE json_extract("p"."value", '$.id') = 'default' LIMIT 1
    ) END,
    ''
  ),
  '',
  CURRENT_TIMESTAMP,
  ''
FROM "GuildModule" AS "gm"
WHERE "gm"."moduleId" = 'tickets'
  AND (
    (CASE WHEN json_valid("gm"."settings") THEN json_extract("gm"."settings", '$.panel.channel') END) IS NOT NULL
    OR EXISTS (SELECT 1 FROM "Ticket" AS "t" WHERE "t"."guildId" = "gm"."guildId" AND "t"."panelId" = 'default')
  )
  AND NOT EXISTS (SELECT 1 FROM "TicketPanelPost" AS "pp" WHERE "pp"."guildId" = "gm"."guildId" AND "pp"."panelId" = 'default');
