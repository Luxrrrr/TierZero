-- What Discord showed as the sender of a dashboard reply sent under the support
-- team's name. Existing messages have none, which is how they were shown before.
ALTER TABLE "TicketMessage" ADD COLUMN "sentAs" TEXT;
