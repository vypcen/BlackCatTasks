ALTER TABLE project_fields ALTER COLUMN project_id DROP NOT NULL;
CREATE UNIQUE INDEX task_fields_shared_active_name ON project_fields(lower(name))
  WHERE project_id IS NULL AND archived_at IS NULL;
