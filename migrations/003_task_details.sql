ALTER TABLE tasks
  ADD COLUMN tracker text NOT NULL DEFAULT 'task' CHECK (tracker IN ('task', 'bug', 'feature', 'support')),
  ADD COLUMN category text NOT NULL DEFAULT '',
  ADD COLUMN target_version text NOT NULL DEFAULT '',
  ADD COLUMN parent_id integer REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN start_date date,
  ADD COLUMN due_date date,
  ADD COLUMN estimated_hours numeric(8, 2) CHECK (estimated_hours >= 0),
  ADD COLUMN done_ratio smallint NOT NULL DEFAULT 0 CHECK (done_ratio BETWEEN 0 AND 100),
  ADD CONSTRAINT tasks_valid_dates CHECK (start_date <= due_date),
  ADD CONSTRAINT tasks_not_own_parent CHECK (id <> parent_id);

UPDATE tasks SET done_ratio = 100 WHERE status = 'done';

CREATE INDEX tasks_parent_id ON tasks(parent_id) WHERE parent_id IS NOT NULL;
