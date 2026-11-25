CREATE TABLE projects (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9]{0,9}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  builtin_fields jsonb NOT NULL DEFAULT '{}',
  next_task_number integer NOT NULL DEFAULT 1,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_fields (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'textarea', 'number', 'date', 'select')),
  required boolean NOT NULL DEFAULT false,
  options text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz
);

CREATE UNIQUE INDEX project_fields_active_name ON project_fields (project_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE tasks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id),
  number integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  creator_id integer NOT NULL REFERENCES users(id),
  customer text NOT NULL DEFAULT '',
  assignee_id integer REFERENCES users(id),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'review', 'done')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  custom_values jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE task_attachments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  creator_id integer NOT NULL REFERENCES users(id),
  name text NOT NULL,
  url text,
  mime text,
  data bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (url IS NOT NULL AND mime IS NULL AND data IS NULL) OR
    (url IS NULL AND mime IS NOT NULL AND data IS NOT NULL AND octet_length(data) BETWEEN 1 AND 10485760)
  )
);

CREATE INDEX task_attachments_task_id ON task_attachments(task_id);
