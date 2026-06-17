-- Add group_name column to tasks table.
-- Groups were previously stored only in browser localStorage; this column
-- allows them to sync across devices and between the web and desktop apps.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_name text;
