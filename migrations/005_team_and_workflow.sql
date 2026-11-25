ALTER TABLE users
  ADD COLUMN job_title text NOT NULL DEFAULT '',
  ADD COLUMN bio text NOT NULL DEFAULT '',
  ADD COLUMN custom_values jsonb NOT NULL DEFAULT '{}';

CREATE TABLE user_fields (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'textarea', 'number', 'date', 'select', 'url')),
  required boolean NOT NULL DEFAULT false,
  options text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz
);
CREATE UNIQUE INDEX user_fields_active_name ON user_fields (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE task_statuses (
  key text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  closed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX task_statuses_name ON task_statuses (lower(name));
INSERT INTO task_statuses (key, name, position, closed) VALUES
  ('todo', 'К выполнению', 10, false), ('doing', 'В работе', 20, false),
  ('review', 'На проверке', 30, false), ('done', 'Готово', 40, true);

ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_fk FOREIGN KEY (status) REFERENCES task_statuses(key);
CREATE INDEX tasks_assignee_id ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

CREATE TABLE task_relations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('relates', 'blocks', 'duplicates')),
  CHECK (source_id <> target_id),
  CHECK (kind <> 'relates' OR source_id < target_id),
  UNIQUE (source_id, target_id, kind)
);
CREATE INDEX task_relations_target ON task_relations(target_id);
