-- CreateTable
CREATE TABLE "ServerLogEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT,
    "targetName" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT,
    "channelName" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "ServerLogEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServerLogEntry_guildId_at_idx" ON "ServerLogEntry"("guildId", "at");

-- CreateIndex
CREATE INDEX "ServerLogEntry_guildId_category_at_idx" ON "ServerLogEntry"("guildId", "category", "at");

-- CreateIndex
CREATE INDEX "ServerLogEntry_guildId_type_at_idx" ON "ServerLogEntry"("guildId", "type", "at");

-- CreateIndex
CREATE INDEX "ServerLogEntry_guildId_actorId_at_idx" ON "ServerLogEntry"("guildId", "actorId", "at");

-- CreateIndex
CREATE INDEX "ServerLogEntry_guildId_targetId_at_idx" ON "ServerLogEntry"("guildId", "targetId", "at");

-- CreateIndex
CREATE INDEX "ServerLogEntry_guildId_channelId_at_idx" ON "ServerLogEntry"("guildId", "channelId", "at");

-- The message log used to be a setting of the Moderation module. A server that had it on keeps it on, now as the
-- Messages part of Server logs, with the same number of days, left-out channels and who can open it.
INSERT INTO "GuildModule" ("guildId", "moduleId", "enabled", "settings", "version", "updatedAt")
SELECT
    "guildId",
    'serverlog',
    1,
    json_object(
        'categories', json_object('members', json('false'), 'messages', json('true'), 'moderation', json('false'), 'roles', json('false'), 'channels', json('false'), 'voice', json('false'), 'server', json('false')),
        'days', COALESCE(json_extract("settings", '$.messageLogDays'), 30),
        'exclude', COALESCE(json_extract("settings", '$.messageLogExclude'), json('[]')),
        'modsCanView', COALESCE(json_extract("settings", '$.messageLogModsCanView'), json('false'))
    ),
    1,
    CURRENT_TIMESTAMP
FROM "GuildModule"
WHERE "moduleId" = 'moderation' AND json_valid("settings") AND json_extract("settings", '$.messageLog') = 1
ON CONFLICT ("guildId", "moduleId") DO NOTHING;
