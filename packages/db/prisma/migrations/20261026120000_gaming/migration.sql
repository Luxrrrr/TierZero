-- CreateTable
CREATE TABLE "VoiceRoom" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceRoom_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LfgPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "gameId" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "needed" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "startsAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "voiceChannelId" TEXT,
    CONSTRAINT "LfgPost_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LfgMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LfgMember_postId_fkey" FOREIGN KEY ("postId") REFERENCES "LfgPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignupEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "startsAt" DATETIME,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "waitlist" BOOLEAN NOT NULL DEFAULT true,
    "requiredRoles" TEXT NOT NULL DEFAULT '[]',
    "rewardRoleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "SignupEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignupEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "captainId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignupEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SignupEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignupMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "SignupMember_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SignupEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignupMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SignupEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceRoom_channelId_key" ON "VoiceRoom"("channelId");

-- CreateIndex
CREATE INDEX "VoiceRoom_guildId_hubId_idx" ON "VoiceRoom"("guildId", "hubId");

-- CreateIndex
CREATE INDEX "VoiceRoom_guildId_ownerId_idx" ON "VoiceRoom"("guildId", "ownerId");

-- CreateIndex
CREATE INDEX "LfgPost_guildId_status_idx" ON "LfgPost"("guildId", "status");

-- CreateIndex
CREATE INDEX "LfgPost_guildId_authorId_status_idx" ON "LfgPost"("guildId", "authorId", "status");

-- CreateIndex
CREATE INDEX "LfgPost_guildId_authorId_createdAt_idx" ON "LfgPost"("guildId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "LfgPost_status_expiresAt_idx" ON "LfgPost"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LfgMember_postId_userId_key" ON "LfgMember"("postId", "userId");

-- CreateIndex
CREATE INDEX "SignupEvent_guildId_status_idx" ON "SignupEvent"("guildId", "status");

-- CreateIndex
CREATE INDEX "SignupEvent_guildId_createdAt_idx" ON "SignupEvent"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "SignupEntry_eventId_status_id_idx" ON "SignupEntry"("eventId", "status", "id");

-- CreateIndex
CREATE INDEX "SignupMember_entryId_idx" ON "SignupMember"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "SignupMember_eventId_userId_key" ON "SignupMember"("eventId", "userId");

