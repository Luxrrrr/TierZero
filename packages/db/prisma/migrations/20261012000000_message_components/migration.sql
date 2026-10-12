-- Select menus saved with a template.
ALTER TABLE "MessageTemplate" ADD COLUMN "selects" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "MessageInteraction" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "buttons" TEXT NOT NULL DEFAULT '[]',
    "selects" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageInteraction_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MessageInteraction_guildId_idx" ON "MessageInteraction"("guildId");
