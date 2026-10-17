-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TicketMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticketId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "authorIsStaff" BOOLEAN NOT NULL DEFAULT false,
    "authorColor" TEXT,
    "authorBot" BOOLEAN NOT NULL DEFAULT false,
    "replyToId" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "embeds" TEXT NOT NULL DEFAULT '[]',
    "components" TEXT NOT NULL DEFAULT '[]',
    "stickers" TEXT NOT NULL DEFAULT '[]',
    "reactions" TEXT NOT NULL DEFAULT '[]',
    "mentions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "edits" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'discord',
    CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TicketMessage" ("attachments", "authorAvatar", "authorId", "authorIsStaff", "authorName", "content", "createdAt", "deletedAt", "editedAt", "edits", "embeds", "id", "messageId", "source", "ticketId") SELECT "attachments", "authorAvatar", "authorId", "authorIsStaff", "authorName", "content", "createdAt", "deletedAt", "editedAt", "edits", "embeds", "id", "messageId", "source", "ticketId" FROM "TicketMessage";
DROP TABLE "TicketMessage";
ALTER TABLE "new_TicketMessage" RENAME TO "TicketMessage";
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");
CREATE UNIQUE INDEX "TicketMessage_ticketId_messageId_key" ON "TicketMessage"("ticketId", "messageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

