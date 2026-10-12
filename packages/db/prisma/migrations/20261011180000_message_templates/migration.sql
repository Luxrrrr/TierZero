-- CreateTable
CREATE TABLE "MessageFolder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageFolder_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "folderId" INTEGER,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "embeds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSentAt" DATETIME,
    CONSTRAINT "MessageTemplate_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageTemplate_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MessageFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MessageFolder_guildId_idx" ON "MessageFolder"("guildId");

-- CreateIndex
CREATE INDEX "MessageTemplate_guildId_folderId_idx" ON "MessageTemplate"("guildId", "folderId");
