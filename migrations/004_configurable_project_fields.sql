ALTER TABLE projects
  ALTER COLUMN builtin_fields SET DEFAULT '{"customer":{"visible":false,"required":false}}';

UPDATE projects p
SET builtin_fields = p.builtin_fields || '{"customer":{"visible":false,"required":false}}'
WHERE NOT (p.builtin_fields ? 'customer')
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.customer <> '');

ALTER TABLE project_fields DROP CONSTRAINT project_fields_kind_check;
ALTER TABLE project_fields ADD CONSTRAINT project_fields_kind_check
  CHECK (kind IN ('text', 'textarea', 'number', 'date', 'select', 'url'));
