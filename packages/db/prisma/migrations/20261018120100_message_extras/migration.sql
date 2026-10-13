-- What a message carried besides its text and files, such as a sticker or a forward, so a message with no text can say what it was.
ALTER TABLE "LoggedMessage" ADD COLUMN "extras" TEXT NOT NULL DEFAULT '';
