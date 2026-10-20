-- CreateTable
CREATE TABLE "GroupPanelPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupPanelPost_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "threadId" TEXT,
    "controlsMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "number" INTEGER NOT NULL DEFAULT 0,
    "joinBy" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayGroup_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupPanelPost_messageId_key" ON "GroupPanelPost"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPanelPost_guildId_panelId_key" ON "GroupPanelPost"("guildId", "panelId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayGroup_voiceChannelId_key" ON "PlayGroup"("voiceChannelId");

-- CreateIndex
CREATE INDEX "PlayGroup_guildId_status_idx" ON "PlayGroup"("guildId", "status");

-- CreateIndex
CREATE INDEX "PlayGroup_guildId_ownerId_idx" ON "PlayGroup"("guildId", "ownerId");
