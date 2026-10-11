-- CreateTable
CREATE TABLE "ModNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    CONSTRAINT "ModNote_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateTable
CREATE TABLE "ModAudit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetUserId" TEXT,
    "infractionId" INTEGER,
    "noteId" INTEGER,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    CONSTRAINT "ModAudit_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateTable
CREATE TABLE "StaffMember" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("guildId", "userId"),
    CONSTRAINT "StaffMember_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Infraction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "caseNumber" INTEGER NOT NULL DEFAULT 0,
    "voidedAt" DATETIME,
    "voidedBy" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "Infraction_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Case numbers used to be a row's rank within its guild; keep every existing
-- number exactly as it was by writing that rank into the new column.
INSERT INTO "new_Infraction" ("action", "active", "caseNumber", "createdAt", "expiresAt", "guildId", "id", "moderatorId", "reason", "userId") SELECT "action", "active", (SELECT COUNT(*) FROM "Infraction" AS "earlier" WHERE "earlier"."guildId" = "Infraction"."guildId" AND "earlier"."id" <= "Infraction"."id"), "createdAt", "expiresAt", "guildId", "id", "moderatorId", "reason", "userId" FROM "Infraction";
DROP TABLE "Infraction";
ALTER TABLE "new_Infraction" RENAME TO "Infraction";
CREATE INDEX "Infraction_guildId_userId_idx" ON "Infraction"("guildId", "userId");
CREATE INDEX "Infraction_guildId_createdAt_idx" ON "Infraction"("guildId", "createdAt");
CREATE UNIQUE INDEX "Infraction_guildId_caseNumber_key" ON "Infraction"("guildId", "caseNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
-- CreateIndex
CREATE INDEX "ModNote_guildId_userId_idx" ON "ModNote"("guildId", "userId");
-- CreateIndex
CREATE INDEX "ModAudit_guildId_at_idx" ON "ModAudit"("guildId", "at");
-- CreateIndex
CREATE INDEX "ModAudit_guildId_targetUserId_idx" ON "ModAudit"("guildId", "targetUserId");
-- CreateIndex
CREATE INDEX "ModAudit_infractionId_idx" ON "ModAudit"("infractionId");
-- CreateIndex
CREATE INDEX "ModAudit_noteId_idx" ON "ModAudit"("noteId");
