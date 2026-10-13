-- Who deleted a logged message: the author, a moderator, automod or the bot. Empty when the log could not tell.
ALTER TABLE "LoggedMessage" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "LoggedMessage" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "LoggedMessage" ADD COLUMN "deletedByName" TEXT;
