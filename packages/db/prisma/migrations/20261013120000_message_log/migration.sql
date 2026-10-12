-- CreateTable
CREATE TABLE "LoggedMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    CONSTRAINT "LoggedMessage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoggedMessageEdit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loggedId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "LoggedMessageEdit_loggedId_fkey" FOREIGN KEY ("loggedId") REFERENCES "LoggedMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LoggedMessage_guildId_messageId_key" ON "LoggedMessage"("guildId", "messageId");

-- CreateIndex
CREATE INDEX "LoggedMessage_guildId_createdAt_idx" ON "LoggedMessage"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "LoggedMessage_guildId_authorId_createdAt_idx" ON "LoggedMessage"("guildId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "LoggedMessage_guildId_channelId_createdAt_idx" ON "LoggedMessage"("guildId", "channelId", "createdAt");

-- CreateIndex
CREATE INDEX "LoggedMessageEdit_loggedId_idx" ON "LoggedMessageEdit"("loggedId");
