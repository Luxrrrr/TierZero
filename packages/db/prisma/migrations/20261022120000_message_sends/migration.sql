-- CreateTable
CREATE TABLE "MessageSend" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "templateId" INTEGER,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "viaWebhook" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageSend_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageSend_guildId_messageId_key" ON "MessageSend"("guildId", "messageId");

-- CreateIndex
CREATE INDEX "MessageSend_guildId_templateId_sentAt_idx" ON "MessageSend"("guildId", "templateId", "sentAt");
