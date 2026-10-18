-- A template the Message creator offers in the ticket reply box. Existing
-- templates stay out of it until someone ticks the box.
ALTER TABLE "MessageTemplate" ADD COLUMN "inTickets" BOOLEAN NOT NULL DEFAULT false;
