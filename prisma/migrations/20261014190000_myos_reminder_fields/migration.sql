-- myOS reminders remain separate from project tasks while reusing the existing
-- event store. Existing rows stay calendar events and remain incomplete=false.
ALTER TABLE "CalendarEvent" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'event';
ALTER TABLE "CalendarEvent" ADD COLUMN "completed" BOOLEAN NOT NULL DEFAULT false;
