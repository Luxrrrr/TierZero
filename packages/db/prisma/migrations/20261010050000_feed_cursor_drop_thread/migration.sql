-- Steam sources are now keyed by game and channel. Rows under the old
-- `steam:<appid>` key would never be read again.
DELETE FROM "FeedCursor" WHERE "sourceKey" LIKE 'steam:%' AND "sourceKey" NOT LIKE 'steam:%:%';

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FeedCursor" (
    "guildId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "seen" TEXT NOT NULL DEFAULT '[]',
    "checkedAt" DATETIME,
    "lastError" TEXT,
    PRIMARY KEY ("guildId", "sourceKey"),
    CONSTRAINT "FeedCursor_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FeedCursor" ("checkedAt", "guildId", "lastError", "seen", "sourceKey") SELECT "checkedAt", "guildId", "lastError", "seen", "sourceKey" FROM "FeedCursor";
DROP TABLE "FeedCursor";
ALTER TABLE "new_FeedCursor" RENAME TO "FeedCursor";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
