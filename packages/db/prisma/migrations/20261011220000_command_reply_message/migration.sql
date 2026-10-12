-- A command's reply can now be a whole message. The old text column stays and is still read.
ALTER TABLE "CommandOverride" ADD COLUMN "responseBody" TEXT;
