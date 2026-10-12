-- Per-command overrides for who sees a command and how it replies. All three
-- are null until an owner sets them, which keeps the command's own behaviour.
ALTER TABLE "CommandOverride" ADD COLUMN "permissions" TEXT;
ALTER TABLE "CommandOverride" ADD COLUMN "ephemeral" BOOLEAN;
ALTER TABLE "CommandOverride" ADD COLUMN "response" TEXT;
