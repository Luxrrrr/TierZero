-- Link buttons and reactions saved with a message template.
ALTER TABLE "MessageTemplate" ADD COLUMN "buttons" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "MessageTemplate" ADD COLUMN "reactions" TEXT NOT NULL DEFAULT '[]';
