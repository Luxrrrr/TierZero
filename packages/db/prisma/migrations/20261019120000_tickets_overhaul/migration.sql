-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticketId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "authorIsStaff" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL DEFAULT '',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "embeds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "edits" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'discord',
    CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticketId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticketId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketPanelPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketPanelPost_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketCooldown" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "until" DATETIME NOT NULL,
    CONSTRAINT "TicketCooldown_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketAudit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ticketId" INTEGER,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketAudit_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ticket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "openerId" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    "typeId" TEXT,
    "panelId" TEXT,
    "typeName" TEXT NOT NULL DEFAULT '',
    "answers" TEXT NOT NULL DEFAULT '[]',
    "claimedById" TEXT,
    "claimedAt" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "firstResponseAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closeReason" TEXT,
    "closedByName" TEXT,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "ratedAt" DATETIME,
    "mode" TEXT NOT NULL DEFAULT 'channel',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "channelName" TEXT NOT NULL DEFAULT '',
    "openerName" TEXT NOT NULL DEFAULT '',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "closeRequestedAt" DATETIME,
    "controlsMessageId" TEXT,
    CONSTRAINT "Ticket_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Tickets opened before types existed all belong to the one type the settings
-- upgrade creates from the old panel (ids in packages/core/src/tickets.ts), and
-- were last active when they opened or closed rather than when this ran.
INSERT INTO "new_Ticket" ("channelId", "closedAt", "closedBy", "guildId", "id", "openedAt", "openerId", "status", "subject", "typeId", "panelId", "typeName", "lastActivityAt")
SELECT "channelId", "closedAt", "closedBy", "guildId", "id", "openedAt", "openerId", "status", "subject", 'support', 'default', 'Support', COALESCE("closedAt", "openedAt") FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket"("guildId", "status");
CREATE INDEX "Ticket_guildId_openedAt_idx" ON "Ticket"("guildId", "openedAt");
CREATE INDEX "Ticket_guildId_typeId_status_idx" ON "Ticket"("guildId", "typeId", "status");
CREATE INDEX "Ticket_guildId_claimedById_idx" ON "Ticket"("guildId", "claimedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketMessage_ticketId_messageId_key" ON "TicketMessage"("ticketId", "messageId");

-- CreateIndex
CREATE INDEX "TicketNote_ticketId_createdAt_idx" ON "TicketNote"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPanelPost_guildId_panelId_key" ON "TicketPanelPost"("guildId", "panelId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCooldown_guildId_userId_typeId_key" ON "TicketCooldown"("guildId", "userId", "typeId");

-- CreateIndex
CREATE INDEX "TicketAudit_guildId_createdAt_idx" ON "TicketAudit"("guildId", "createdAt");

