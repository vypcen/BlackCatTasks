CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member'))
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

CREATE TABLE invitations (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz
);

CREATE UNIQUE INDEX invitations_pending_email ON invitations(email) WHERE accepted_at IS NULL;

CREATE TABLE folders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);

CREATE UNIQUE INDEX folders_name_unique ON folders(lower(name));

CREATE TABLE test_cases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  folder_id integer REFERENCES folders(id),
  title text NOT NULL,
  preconditions text NOT NULL DEFAULT '',
  steps text NOT NULL,
  expected text NOT NULL,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  build text NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE run_cases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id integer NOT NULL REFERENCES runs(id),
  case_id integer NOT NULL REFERENCES test_cases(id),
  title text NOT NULL,
  preconditions text NOT NULL,
  steps text NOT NULL,
  expected text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'blocked')),
  comment text NOT NULL DEFAULT '',
  defect_url text NOT NULL DEFAULT '',
  recorded_by integer REFERENCES users(id),
  recorded_at timestamptz,
  UNIQUE (run_id, case_id)
);
