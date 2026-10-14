-- 0096: add a lightweight reminder type to existing calendar records.
-- Reminders are independent of Task and must not carry a task_id. Existing
-- rows keep their calendar-event meaning and every existing value is retained.
ALTER TABLE lifeos_calendar_events
    ADD COLUMN event_type TEXT NOT NULL DEFAULT 'event';
ALTER TABLE lifeos_calendar_events
    ADD COLUMN completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1));
