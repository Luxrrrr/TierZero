-- Messages attached to an action, copied as they read when it was taken.
ALTER TABLE "Infraction" ADD COLUMN "evidence" TEXT NOT NULL DEFAULT '[]';
