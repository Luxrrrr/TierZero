-- CreateTable
CREATE TABLE "FeedCursor" (
    "guildId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "seen" TEXT NOT NULL DEFAULT '[]',
    "threadId" TEXT,
    "checkedAt" DATETIME,
    "lastError" TEXT,

    PRIMARY KEY ("guildId", "sourceKey"),
    CONSTRAINT "FeedCursor_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
