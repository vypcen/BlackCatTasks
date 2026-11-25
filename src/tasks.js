import { pool, transaction } from './db.js';
import { field, id, requireThat, readBytes } from './http.js';
import { randomUUID } from 'node:crypto';
import { choice, object, webLink, fieldDefinition, calendarDate, customValues } from './custom-fields.js';
const priorities = ['low', 'normal', 'high'];
const trackers = ['task', 'bug', 'feature', 'support'];
const builtinNames = {
  description: 'Описание', customer: 'Заказчик', assignee_id: 'Исполнитель', priority: 'Приоритет',
  category: 'Категория', target_version: 'Целевая версия', parent_id: 'Родительская задача',
  start_date: 'Дата начала', due_date: 'Срок', estimated_hours: 'Оценка, ч', done_ratio: 'Готовность, %',
};
const maxFileSize = 10 * 1024 * 1024;
const param = '/(\\d+)';
const projectPath = '/projects' + param;
const taskPath = projectPath + '/tasks' + param;
const attachmentPath = taskPath + '/attachments';
const taskSelect = `
  SELECT t.*, creator.name AS creator, assignee.name AS assignee,
    parent.number AS parent_number, parent.title AS parent_title,
    (SELECT count(*)::int FROM task_attachments a WHERE a.task_id = t.id) AS attachment_count
  FROM tasks t JOIN users creator ON creator.id = t.creator_id
  LEFT JOIN users assignee ON assignee.id = t.assignee_id
  LEFT JOIN tasks parent ON parent.id = t.parent_id AND parent.project_id = t.project_id
`;
const attachmentColumns = 'id, name, url, mime, octet_length(data) AS size, created_at';
const relationLock = 67392004;
const fieldScopeLock = 67392005;

async function statusKey(db, value) {
  const status = field(value, 'Статус', 60);
  const { rowCount } = await db.query('SELECT 1 FROM task_statuses WHERE key = $1', [status]);
  requireThat(rowCount, 400, 'Выберите существующий статус задачи.');
  return status;
}

function statusFields(body) {
  const name = field(body.name, 'Название статуса', 60);
  requireThat(/^\d{1,6}$/.test(String(body.position)) && typeof body.closed === 'boolean',
    400, 'Проверьте порядок и признак завершения статуса.');
  return [name, Number(body.position), body.closed];
}

async function getProject(db, projectId, lock = false) {
  const { rows: [project] } = await db.query(
    'SELECT id, code, name, description, builtin_fields FROM projects WHERE id = $1' + (lock ? ' FOR UPDATE' : ''), [projectId]);
  requireThat(project, 404, 'Проект не найден.');
  return project;
}

async function getFields(db, projectId) {
  return (await db.query(
    'SELECT id, project_id, name, kind, required, options, archived_at FROM project_fields WHERE project_id = $1 OR project_id IS NULL ORDER BY id',
    [projectId])).rows;
}

async function lockTask(db, projectId, taskId) {
  const { rows: [task] } = await db.query('SELECT * FROM tasks WHERE project_id = $1 AND id = $2 FOR UPDATE', [projectId, taskId]);
  requireThat(task, 404, 'Задача не найдена.');
  return task;
}

function builtinConfig(config) {
  requireThat(object(config), 400, 'Проверьте настройки полей.');
  const result = {};
  for (const key of Object.keys(builtinNames)) {
    const value = config[key];
    if (value == null) continue;
    requireThat(object(value) && typeof value.visible === 'boolean' && typeof value.required === 'boolean',
      400, 'Проверьте настройки поля «' + builtinNames[key] + '».');
    result[key] = { visible: value.visible, required: value.visible && value.required };
  }
  return result;
}

function requireDistinctFieldName(name, config) {
  const standardFields = ['Заголовок', 'Тип задачи', 'Создатель', 'Статус'];
  for (const [key, label] of Object.entries(builtinNames)) {
    if (config[key]?.visible !== false) standardFields.push(label);
  }
  const normalized = name.toLocaleLowerCase('ru');
  requireThat(!standardFields.some(label => label.toLocaleLowerCase('ru') === normalized),
    409, 'Поле «' + name + '» уже включено в стандартных полях проекта.');
}

async function writeTaskField(projectId, fieldId, body) {
  return transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [fieldScopeLock]);
    const project = projectId === null ? null : await getProject(db, projectId, true);
    const fields = project ? await getFields(db, projectId) : (await db.query(
      'SELECT id, project_id, name, kind, required, options, archived_at FROM project_fields')).rows;
    const scoped = fields.filter(item => item.project_id === projectId);
    const previous = fieldId === null ? null : scoped.find(item => item.id === fieldId);
    requireThat(fieldId === null || previous, 404, 'Дополнительное поле не найдено.');

    const toggling = previous && typeof body.archived === 'boolean';
    const definition = toggling ? null : fieldDefinition(body, previous);
    const name = definition ? definition[0] : previous.name;
    const willBeActive = toggling ? !body.archived : !previous?.archived_at;
    if (willBeActive) {
      if (!previous || previous.archived_at) {
        requireThat(scoped.filter(item => !item.archived_at).length < 30, 409, 'В этом наборе может быть до 30 активных полей.');
      }
      const normalized = name.toLocaleLowerCase('ru');
      requireThat(!fields.some(item => item.id !== fieldId && !item.archived_at && item.name.toLocaleLowerCase('ru') === normalized),
        409, 'Поле с таким названием уже используется.');
      if (project) {
        requireDistinctFieldName(name, project.builtin_fields);
      } else {
        requireDistinctFieldName(name, { customer: { visible: false } });
        const { rows } = await db.query('SELECT builtin_fields FROM projects');
        for (const item of rows) requireDistinctFieldName(name, item.builtin_fields);
      }
    }
    if (!previous) return (await db.query(
      'INSERT INTO project_fields (project_id, name, kind, required, options) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [projectId, ...definition])).rows[0];
    if (toggling) {
      await db.query('UPDATE project_fields SET archived_at = CASE WHEN $1 THEN now() END WHERE id = $2', [body.archived, fieldId]);
    } else {
      const [name, , required, options] = definition;
      await db.query('UPDATE project_fields SET name = $1, required = $2, options = $3 WHERE id = $4', [name, required, options, fieldId]);
    }
    return { id: fieldId };
  });
}

function planningValue(project, body, previous, key, fallback = null) {
  const mode = project.builtin_fields[key];
  const value = mode?.visible === false || !Object.hasOwn(body, key) ? previous?.[key] ?? fallback : body[key];
  requireThat(!mode?.required || (value != null && String(value).trim() !== ''), 400, 'Заполните поле «' + builtinNames[key] + '».');
  return value;
}

async function planningFields(db, project, body, previous, forcedParent) {
  const tracker = choice(body.tracker ?? previous?.tracker ?? 'task', trackers, 'Тип задачи');
  const category = field(planningValue(project, body, previous, 'category', ''), 'Категория', 120, false);
  const targetVersion = field(planningValue(project, body, previous, 'target_version', ''), 'Целевая версия', 120, false);
  const start = calendarDate(planningValue(project, body, previous, 'start_date'), 'Дата начала');
  const due = calendarDate(planningValue(project, body, previous, 'due_date'), 'Срок');
  requireThat(!start || !due || start <= due, 400, 'Срок должен быть не раньше даты начала.');

  const hours = planningValue(project, body, previous, 'estimated_hours');
  requireThat(hours == null || hours === '' || /^\d{1,6}(?:\.\d{1,2})?$/.test(String(hours)),
    400, 'Укажите неотрицательную оценку до 999999,99 часа с точностью до сотых.');
  const ratio = planningValue(project, body, previous, 'done_ratio', 0);
  requireThat(/^\d{1,3}$/.test(String(ratio)) && Number(ratio) <= 100, 400, 'Готовность должна быть целым числом от 0 до 100.');

  const parentValue = forcedParent ?? planningValue(project, body, previous, 'parent_id');
  const parent = parentValue == null || parentValue === '' ? null : id(parentValue);
  if (parent && parent !== previous?.parent_id) {
    const { rows } = await db.query(`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM tasks WHERE project_id = $1 AND id = $2
        UNION
        SELECT t.id, t.parent_id FROM tasks t JOIN ancestors a ON a.parent_id = t.id WHERE t.project_id = $1
      )
      SELECT id FROM ancestors
    `, [project.id, parent]);
    requireThat(rows.length, 400, 'Родительская задача должна быть в том же проекте.');
    requireThat(!rows.some(item => item.id === previous?.id), 400, 'Родительская задача не может образовывать цикл.');
  }
  return [tracker, category, targetVersion, parent, start, due, hours === '' ? null : hours, Number(ratio)];
}

async function taskFields(db, project, body, previous, forcedParent) {
  const fields = await getFields(db, project.id);
  const values = customValues(fields, body.custom_values, previous?.custom_values);
  const config = project.builtin_fields;
  function content(key, max) {
    return config[key]?.visible === false
      ? previous?.[key] ?? ''
      : field(body[key], builtinNames[key], max, config[key]?.required ?? false);
  }
  const assigneeValue = config.assignee_id?.visible === false ? previous?.assignee_id : body.assignee_id;
  const assignee = assigneeValue == null || assigneeValue === '' ? null : id(assigneeValue);
  requireThat(!config.assignee_id?.required || assignee, 400, 'Выберите исполнителя.');
  const priority = config.priority?.visible === false ? previous?.priority ?? 'normal' : body.priority ?? 'normal';
  return [
    field(body.title, 'Заголовок', 160), content('description', 12000), content('customer', 180), assignee,
    await statusKey(db, body.status ?? 'todo'), choice(priority, priorities, 'Приоритет'), values,
    ...await planningFields(db, project, body, previous, forcedParent),
  ];
}

async function createTask(db, projectId, userId, body, parentId) {
  const project = await getProject(db, projectId, true);
  const payload = await taskFields(db, project, body, null, parentId);
  const { rows: [{ number }] } = await db.query(
    'UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = $1 RETURNING next_task_number - 1 AS number', [projectId]);
  return (await db.query(`
    INSERT INTO tasks (project_id, number, creator_id, title, description, customer, assignee_id, status, priority, custom_values,
      tracker, category, target_version, parent_id, start_date, due_date, estimated_hours, done_ratio)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id, number
  `, [projectId, number, userId, ...payload])).rows[0];
}

async function relatedTasks(taskId) {
  return (await pool.query(`
    SELECT r.id, r.kind, r.source_id = $1 AS outgoing,
      t.id AS task_id, t.project_id, p.code AS project_code, t.number, t.title, t.status
    FROM task_relations r
    JOIN tasks t ON t.id = CASE WHEN r.source_id = $1 THEN r.target_id ELSE r.source_id END
    JOIN projects p ON p.id = t.project_id
    WHERE r.source_id = $1 OR r.target_id = $1 ORDER BY r.id
  `, [taskId])).rows;
}

function fileMime(data) {
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

async function addAttachment(projectId, taskId, userId, attachment) {
  return transaction(async db => {
    await lockTask(db, projectId, taskId);
    const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM task_attachments WHERE task_id = $1', [taskId]);
    requireThat(count < 20, 409, 'В задаче может быть до 20 вложений.');
    return (await db.query(`
      INSERT INTO task_attachments (task_id, creator_id, name, url, mime, data)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${attachmentColumns}
    `, [taskId, userId, attachment.name, attachment.url, attachment.mime, attachment.data])).rows[0];
  });
}

export function registerTaskRoutes(route) {
  route('GET', '/statuses', 'member', async () => (await pool.query(
    'SELECT key, name, position, closed FROM task_statuses ORDER BY position, key')).rows);

  route('POST', '/statuses', 'admin', async ({ body }) => {
    const key = 'custom-' + randomUUID();
    const { rows: [status] } = await pool.query(
      'INSERT INTO task_statuses (key, name, position, closed) VALUES ($1, $2, $3, $4) RETURNING key',
      [key, ...statusFields(body)]);
    return status;
  });

  route('PATCH', '/statuses/([a-z0-9-]{1,60})', 'admin', async ({ args, body }) => {
    const { rows: [status] } = await pool.query(
      'UPDATE task_statuses SET name = $1, position = $2, closed = $3 WHERE key = $4 RETURNING key',
      [...statusFields(body), args[0]]);
    requireThat(status, 404, 'Статус не найден.');
    return status;
  });

  route('GET', '/my-tasks', 'member', async ({ user }) => (await pool.query(`
    SELECT t.id, t.number, t.title, t.status, t.due_date, p.id AS project_id, p.code AS project_code, p.name AS project_name
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.assignee_id = $1 ORDER BY t.updated_at DESC, t.id DESC
  `, [user.id])).rows);

  route('GET', '/projects', 'member', async () => (await pool.query(`
    SELECT p.id, p.code, p.name, p.description, count(t.id)::int AS total,
      (count(*) FILTER (WHERE s.closed))::int AS done
    FROM projects p LEFT JOIN tasks t ON t.project_id = p.id LEFT JOIN task_statuses s ON s.key = t.status
    GROUP BY p.id ORDER BY p.id
  `)).rows);

  route('POST', '/projects', 'admin', async ({ body, user }) => {
    const name = field(body.name, 'Название проекта', 100);
    const code = field(body.code, 'Ключ проекта', 10).toUpperCase();
    requireThat(/^[A-Z][A-Z0-9]{0,9}$/.test(code), 400, 'Ключ проекта начинается с латинской буквы и может содержать цифры.');
    const description = field(body.description, 'Описание проекта', 300, false);
    return (await pool.query(
      'INSERT INTO projects (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [code, name, description, user.id])).rows[0];
  });

  route('GET', projectPath, 'member', async ({ args }) => {
    const projectId = id(args[0]);
    const project = await getProject(pool, projectId);
    const [fields, tasks] = await Promise.all([
      getFields(pool, projectId),
      pool.query(taskSelect + ' WHERE t.project_id = $1 ORDER BY t.updated_at DESC, t.id DESC', [projectId]),
    ]);
    return { project, fields, tasks: tasks.rows };
  });

  route('GET', projectPath + '/configuration', 'admin', async ({ args }) => {
    const projectId = id(args[0]);
    const [project, fields] = await Promise.all([getProject(pool, projectId), getFields(pool, projectId)]);
    return { project, fields: fields.filter(item => item.project_id === projectId) };
  });

  route('PATCH', projectPath, 'admin', async ({ args, body }) => {
    const projectId = id(args[0]);
    const name = field(body.name, 'Название проекта', 100);
    const description = field(body.description, 'Описание проекта', 300, false);
    const changes = builtinConfig(body.builtin_fields ?? {});
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [fieldScopeLock]);
      const current = await getProject(db, projectId, true);
      const config = { ...current.builtin_fields, ...changes };
      if (Object.keys(changes).length) {
        const fields = await getFields(db, projectId);
        for (const definition of fields.filter(item => !item.archived_at)) {
          requireDistinctFieldName(definition.name, config);
        }
      }
      const { rows: [project] } = await db.query(
        'UPDATE projects SET name = $1, description = $2, builtin_fields = $3 WHERE id = $4 RETURNING id',
        [name, description, config, projectId]);
      return project;
    });
  });

  route('POST', projectPath + '/fields', 'admin', ({ args, body }) => writeTaskField(id(args[0]), null, body));
  route('PATCH', projectPath + '/fields' + param, 'admin', ({ args, body }) => writeTaskField(id(args[0]), id(args[1]), body));
  route('GET', '/task-fields', 'admin', () => getFields(pool, null));
  route('POST', '/task-fields', 'admin', ({ body }) => writeTaskField(null, null, body));
  route('PATCH', '/task-fields' + param, 'admin', ({ args, body }) => writeTaskField(null, id(args[0]), body));

  route('POST', projectPath + '/tasks', 'member', async ({ args, body, user }) => {
    const projectId = id(args[0]);
    return transaction(db => createTask(db, projectId, user.id, body));
  });

  route('POST', taskPath + '/subtasks', 'member', async ({ args, body, user }) => {
    const [projectId, parentId] = args.map(id);
    return transaction(db => createTask(db, projectId, user.id, body, parentId));
  });

  route('GET', taskPath, 'member', async ({ args }) => {
    const { rows: [task] } = await pool.query(taskSelect + ' WHERE t.project_id = $1 AND t.id = $2', args.map(id));
    requireThat(task, 404, 'Задача не найдена.');
    const [project, fields, attachments, children, relations] = await Promise.all([
      getProject(pool, task.project_id), getFields(pool, task.project_id),
      pool.query('SELECT ' + attachmentColumns + ' FROM task_attachments WHERE task_id = $1 ORDER BY id', [task.id]),
      pool.query('SELECT id, number, title, status FROM tasks WHERE project_id = $1 AND parent_id = $2 ORDER BY number', [task.project_id, task.id]),
      relatedTasks(task.id),
    ]);
    return { project, fields, task, attachments: attachments.rows, children: children.rows, relations };
  });

  route('GET', taskPath + '/edit-options', 'member', async ({ args }) => {
    const [projectId, taskId] = args.map(id);
    const { rows } = await pool.query('SELECT id, number, title FROM tasks WHERE project_id = $1 ORDER BY number', [projectId]);
    requireThat(rows.some(item => item.id === taskId), 404, 'Задача не найдена.');
    return rows.filter(item => item.id !== taskId);
  });

  route('PATCH', taskPath, 'member', async ({ args, body }) => {
    const [projectId, taskId] = args.map(id);
    return transaction(async db => {
      const project = await getProject(db, projectId, true);
      const previous = await lockTask(db, projectId, taskId);
      requireThat(Number.isInteger(body.version) && body.version === previous.version, 409, 'Задача изменилась. Отмените редактирование и откройте её заново.');
      if (Object.keys(body).length === 2 && Object.hasOwn(body, 'status')) {
        await db.query('UPDATE tasks SET status = $1, updated_at = now(), version = version + 1 WHERE id = $2',
          [await statusKey(db, body.status), taskId]);
      } else {
        const payload = await taskFields(db, project, body, previous);
        await db.query(`
          UPDATE tasks SET title = $1, description = $2, customer = $3, assignee_id = $4, status = $5, priority = $6,
            custom_values = $7, tracker = $8, category = $9, target_version = $10, parent_id = $11,
            start_date = $12, due_date = $13, estimated_hours = $14, done_ratio = $15,
            updated_at = now(), version = version + 1 WHERE id = $16
        `, [...payload, taskId]);
      }
      return { id: taskId };
    });
  });

  route('DELETE', taskPath, 'member', async ({ args }) => {
    const [projectId, taskId] = args.map(id);
    return transaction(async db => {
      await getProject(db, projectId, true);
      const { rowCount } = await db.query('DELETE FROM tasks WHERE project_id = $1 AND id = $2', [projectId, taskId]);
      requireThat(rowCount, 404, 'Задача не найдена.');
      return {};
    });
  });

  route('GET', taskPath + '/relation-options', 'member', async ({ args }) => {
    const [projectId, taskId] = args.map(id);
    const found = await pool.query('SELECT id FROM tasks WHERE project_id = $1 AND id = $2', [projectId, taskId]);
    requireThat(found.rowCount, 404, 'Задача не найдена.');
    return (await pool.query(`
      SELECT t.id, t.number, t.title, p.code AS project_code
      FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id <> $1 ORDER BY p.code, t.number
    `, [taskId])).rows;
  });

  route('POST', taskPath + '/relations', 'member', async ({ args, body }) => {
    const [projectId, taskId] = args.map(id);
    const otherId = id(body.task_id);
    const kind = choice(body.kind, ['relates', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by'], 'Тип связи');
    requireThat(taskId !== otherId, 400, 'Укажите другую задачу.');
    const reverse = ['blocked_by', 'duplicated_by'].includes(kind) || (kind === 'relates' && taskId > otherId);
    const [source, target] = reverse ? [otherId, taskId] : [taskId, otherId];
    const storedKind = { blocked_by: 'blocks', duplicated_by: 'duplicates' }[kind] ?? kind;
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [relationLock]);
      const found = await db.query('SELECT id FROM tasks WHERE project_id = $1 AND id = $2', [projectId, taskId]);
      requireThat(found.rowCount, 404, 'Задача не найдена.');
      if (storedKind === 'blocks') {
        const cycle = await db.query(`
          WITH RECURSIVE downstream AS (
            SELECT $1::int AS task_id
            UNION
            SELECT r.target_id FROM task_relations r JOIN downstream d ON d.task_id = r.source_id WHERE r.kind = 'blocks'
          )
          SELECT 1 FROM downstream WHERE task_id = $2
        `, [target, source]);
        requireThat(!cycle.rowCount, 409, 'Эта связь создаёт цикл блокировок.');
      }
      return (await db.query('INSERT INTO task_relations (source_id, target_id, kind) VALUES ($1, $2, $3) RETURNING id',
        [source, target, storedKind])).rows[0];
    });
  });

  route('DELETE', taskPath + '/relations' + param, 'member', async ({ args }) => {
    const { rowCount } = await pool.query(`
      DELETE FROM task_relations r USING tasks t WHERE r.id = $3 AND t.project_id = $1 AND t.id = $2
        AND (t.id = r.source_id OR t.id = r.target_id)
    `, args.map(id));
    requireThat(rowCount, 404, 'Связь не найдена.');
    return {};
  });

  route('POST', attachmentPath + '/links', 'member', async ({ args, body, user }) => {
    const [projectId, taskId] = args.map(id);
    const url = webLink(field(body.url, 'Ссылка', 2048), 'Ссылка');
    const name = field(body.name, 'Название ссылки', 240, false) || url.hostname;
    return addAttachment(projectId, taskId, user.id, { name, url: url.href });
  });

  route('POST', attachmentPath + '/files', 'member', async ({ args, req, user }) => {
    const [projectId, taskId] = args.map(id);
    requireThat(req.headers['content-type'] === 'application/octet-stream', 415, 'Ожидается файл.');
    let decoded;
    try { decoded = decodeURIComponent(req.headers['x-file-name'] ?? ''); } catch {}
    const name = field(decoded, 'Имя файла', 240).replace(/[\\/\r\n\t]/g, '_');
    const data = await readBytes(req, maxFileSize);
    requireThat(data.length > 0, 400, 'Файл пуст.');
    return addAttachment(projectId, taskId, user.id, { name, mime: fileMime(data), data });
  }, 'raw');

  route('GET', attachmentPath + param, 'member', async ({ args, req, res }) => {
    const { rows: [file] } = await pool.query(`
      SELECT a.name, a.mime, a.data FROM task_attachments a JOIN tasks t ON t.id = a.task_id
      WHERE t.project_id = $1 AND t.id = $2 AND a.id = $3 AND a.data IS NOT NULL
    `, args.map(id));
    requireThat(file, 404, 'Файл не найден.');
    const download = !file.mime.startsWith('image/') || new URL(req.url, 'http://localhost').searchParams.has('download');
    const encoded = encodeURIComponent(file.name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
    res.writeHead(200, {
      'Content-Type': file.mime,
      'Content-Length': file.data.length,
      'Cache-Control': 'private, no-store',
      'Content-Disposition': (download ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encoded,
    });
    res.end(file.data);
  });

  route('DELETE', attachmentPath + param, 'member', async ({ args }) => {
    const { rowCount } = await pool.query(`
      DELETE FROM task_attachments a USING tasks t
      WHERE t.project_id = $1 AND t.id = $2 AND a.id = $3 AND a.task_id = t.id
    `, args.map(id));
    requireThat(rowCount, 404, 'Вложение не найдено.');
    return {};
  });
}
