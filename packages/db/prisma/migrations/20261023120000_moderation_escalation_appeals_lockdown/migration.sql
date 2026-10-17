-- A case the bot took by itself because an escalation rule fired, and whether an
-- automod warning counts toward escalation. Existing cases are not automatic and
-- every existing warning counts, which is how they behaved before.
ALTER TABLE "Infraction" ADD COLUMN "automatic" TEXT;
ALTER TABLE "Infraction" ADD COLUMN "escalates" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Appeal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "infractionId" INTEGER NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "decidedByName" TEXT,
    "response" TEXT,
    CONSTRAINT "Appeal_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appeal_infractionId_fkey" FOREIGN KEY ("infractionId") REFERENCES "Infraction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LockedChannel" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "previous" TEXT NOT NULL,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT NOT NULL,
    "reason" TEXT,
    "endsAt" DATETIME,

    PRIMARY KEY ("guildId", "channelId"),
    CONSTRAINT "LockedChannel_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Appeal_guildId_status_createdAt_idx" ON "Appeal"("guildId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Appeal_guildId_userId_idx" ON "Appeal"("guildId", "userId");

-- CreateIndex
CREATE INDEX "Appeal_infractionId_idx" ON "Appeal"("infractionId");
