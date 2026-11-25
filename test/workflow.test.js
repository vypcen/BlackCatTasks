import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import pg from 'pg';

const database = process.env.TEST_DATABASE_URL;
const password = 'BlackCat Test Password 2026';

test('project task workflow keeps fields and attachments scoped to a project', { skip: !database, timeout: 20_000 }, async t => {
  const schema = 'tms_test_' + randomBytes(6).toString('hex');
  const pool = new pg.Pool({ connectionString: database });
  await pool.query('CREATE SCHEMA ' + schema);
  let server;
  t.after(async () => {
    if (server?.exitCode === null) {
      const stopped = once(server, 'exit');
      server.kill();
      await stopped;
    }
    await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
    await pool.end();
  });

  const env = {
    ...process.env,
    DATABASE_URL: database,
    PGOPTIONS: '-c search_path=' + schema,
    HOST: '127.0.0.1',
    PORT: '0',
    ADMIN_EMAIL: 'admin@example.test',
    ADMIN_PASSWORD: password,
    SECURE_COOKIES: '0',
  };
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, ['src/setup.js'], { env });

  server = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((resolve, reject) => {
    let stdout = '';
    server.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    server.once('error', reject);
    server.once('exit', code => reject(new Error('Server exited with code ' + code)));
  });

  function client() {
    let cookie = '';
    return async (path, method = 'GET', body = {}, expected = method === 'POST' ? 201 : 200) => {
      const headers = { Cookie: cookie };
      const file = body instanceof Uint8Array;
      if (method !== 'GET') headers['Content-Type'] = file ? 'application/octet-stream' : 'application/json';
      if (file) headers['X-File-Name'] = encodeURIComponent('Скриншот.gif');
      const response = await fetch(base + '/api' + path, {
        method, headers, body: method === 'GET' ? undefined : file ? body : JSON.stringify(body),
      });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const data = response.headers.get('content-type')?.startsWith('application/json')
        ? await response.json()
        : { bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    };
  }

  const admin = client();
  const member = client();
  const guest = client();
  await guest('/projects', 'GET', undefined, 401);
  await admin('/login', 'POST', { email: env.ADMIN_EMAIL, password: 'wrong' }, 401);
  const { user: administrator } = await admin('/login', 'POST', { email: env.ADMIN_EMAIL, password });

  const account = await admin('/team/users', 'POST', { name: 'Участник', email: 'member@example.test', password });
  assert.equal(account.role, 'member');
  await member('/login', 'POST', { email: account.email, password });
  await member('/team', 'GET', undefined, 403);
  await member('/team/users', 'POST', { email: 'other@example.test' }, 403);
  await admin('/team/users/' + administrator.id + '/role', 'PATCH', { role: 'member' }, 409);
  const memberRole = '/team/users/' + account.id + '/role';
  await member(memberRole, 'PATCH', { role: 'admin' }, 403);
  await admin(memberRole, 'PATCH', { role: 'admin' });
  assert.equal((await member('/session')).user.role, 'admin');
  assert.ok((await member('/team')).users.length > 0);
  await admin(memberRole, 'PATCH', { role: 'member' });
  await member('/team', 'GET', undefined, 403);
  const invite = await admin('/team/invitations', 'POST', { email: 'invite@example.test' });
  const { user: invited } = await guest('/invitations/' + invite.token, 'POST', { name: 'Приглашённый', password });
  await admin('/invitations/' + invite.token, 'GET', undefined, 404);
  const memberProfile = '/profiles/' + account.id;
  await member('/profiles/' + administrator.id, 'GET', undefined, 403);
  await member('/profile-fields', 'POST', { name: 'Команда' }, 403);
  const profileField = await admin('/profile-fields', 'POST', { name: 'Команда', kind: 'text', required: false });
  assert.equal((await member(memberProfile)).fields[0].id, profileField.id);
  assert.equal((await guest('/profiles/' + invited.id)).fields[0].id, profileField.id);
  await member(memberProfile, 'PATCH', {
    name: account.name, job_title: 'Разработчик', bio: 'Работаю над интерфейсом.',
    custom_values: { [profileField.id]: 'Frontend' },
  });
  const savedProfile = (await admin(memberProfile)).profile;
  assert.equal(savedProfile.job_title, 'Разработчик');
  assert.equal(savedProfile.custom_values[profileField.id], 'Frontend');
  await admin('/profile-fields/' + profileField.id, 'PATCH', { archived: true });
  assert.equal((await member(memberProfile)).fields.length, 0);
  await admin('/profile-fields/' + profileField.id, 'PATCH', { archived: false });
  assert.equal((await member(memberProfile)).profile.custom_values[profileField.id], 'Frontend');
  await member('/statuses', 'POST', { name: 'Бэклог', position: 0, closed: false }, 403);
  const backlog = await admin('/statuses', 'POST', { name: 'Бэклог', position: 0, closed: false });
  assert.equal((await member('/statuses'))[0].key, backlog.key);

  const projectA = await admin('/projects', 'POST', { name: 'Проект А', code: 'A' });
  const projectB = await admin('/projects', 'POST', { name: 'Проект Б', code: 'B' });
  const a = '/projects/' + projectA.id;
  const b = '/projects/' + projectB.id;
  assert.equal((await admin(a + '/configuration')).project.builtin_fields.customer.visible, false);
  await member(a + '/configuration', 'GET', undefined, 403);
  const addField = (path, name, kind = 'text', config = {}) => admin(path + '/fields', 'POST', {
    name, kind, required: false, ...config,
  });
  const tp1a = await addField(a, 'ТП1', 'text', { required: true });
  const tp2 = await addField(a, 'ТП2', 'select', { options: ['Frontend', 'Backend'] });
  await addField(b, 'ТП1');
  await addField(b, 'ТП3', 'date');
  await member(a + '/fields', 'POST', { name: 'Запрещённое поле' }, 403);
  assert.deepEqual((await member(a)).fields.map(item => item.name), ['ТП1', 'ТП2']);
  assert.deepEqual((await member(b)).fields.map(item => item.name), ['ТП1', 'ТП3']);
  await admin(a, 'PATCH', {
    name: 'Проект А', description: '', builtin_fields: {
      customer: { visible: true, required: true },
      priority: { visible: false, required: false },
    },
  });

  const fields = {
    title: 'Подключить фильтры', description: 'Проверить поиск и сортировку', customer: 'Команда продукта',
    status: 'todo', assignee_id: account.id, custom_values: { [tp1a.id]: 'Кабинет', [tp2.id]: 'Frontend' },
  };
  await member(a + '/tasks', 'POST', { ...fields, customer: '' }, 400);
  await member(a + '/tasks', 'POST', { ...fields, custom_values: {} }, 400);
  await member(b + '/tasks', 'POST', fields, 400);
  await member(a + '/tasks', 'POST', { ...fields, custom_values: { [tp1a.id]: 'Кабинет', [tp2.id]: 'Чужой вариант' } }, 400);
  const made = await member(a + '/tasks', 'POST', fields);
  const path = a + '/tasks/' + made.id;
  const page = await fetch(base + path);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /BlackCat Tasks/);
  const { task } = await admin(path);
  assert.equal(task.number, 1);
  assert.equal(task.creator, 'Участник');
  assert.equal(task.customer, 'Команда продукта');
  assert.equal(task.assignee_id, account.id);
  assert.equal(task.custom_values[tp2.id], 'Frontend');
  assert.equal(task.tracker, 'task');
  assert.equal(task.start_date, null);
  await admin(b + '/tasks/' + made.id, 'GET', undefined, 404);

  await admin(a + '/fields/' + tp2.id, 'PATCH', { archived: true });
  await member(path, 'PATCH', { ...fields, version: task.version, title: 'Готово к проверке', status: 'review',
    custom_values: { [tp1a.id]: 'Кабинет' } });
  const updated = (await member(path)).task;
  assert.equal(updated.status, 'review');
  assert.equal(updated.title, 'Готово к проверке');
  assert.equal(updated.custom_values[tp2.id], 'Frontend');
  await admin(a + '/fields/' + tp2.id, 'PATCH', { archived: false });
  await member(path, 'PATCH', { ...fields, version: task.version }, 409);

  const other = await member(b + '/tasks', 'POST', { title: 'Задача другого проекта', status: backlog.key, assignee_id: account.id });
  const otherPath = b + '/tasks/' + other.id;
  assert.equal((await member(otherPath)).task.status, backlog.key);
  await admin('/statuses/' + backlog.key, 'PATCH', { name: 'Бэклог команды', position: 0, closed: false });
  assert.equal((await member('/statuses'))[0].name, 'Бэклог команды');
  const assigned = await member('/my-tasks');
  assert.deepEqual(new Set(assigned.map(item => item.project_id)), new Set([projectA.id, projectB.id]));
  assert.equal((await guest('/my-tasks')).length, 0);
  const planning = {
    tracker: 'bug', category: 'Интерфейс', target_version: '2.0', parent_id: made.id,
    start_date: '2026-11-25', due_date: '2026-12-01', estimated_hours: '3.25', done_ratio: '50',
  };
  await member(a + '/tasks', 'POST', { ...fields, ...planning, parent_id: other.id }, 400);
  await member(a + '/tasks', 'POST', { ...fields, ...planning, due_date: '2026-11-24' }, 400);
  await member(a + '/tasks', 'POST', { ...fields, ...planning, done_ratio: 101 }, 400);
  const child = await member(path + '/subtasks', 'POST', { ...fields, ...planning, parent_id: other.id, title: 'Проверить поиск' });
  const childPath = a + '/tasks/' + child.id;
  const childDetail = await member(childPath);
  assert.equal(childDetail.task.parent_title, updated.title);
  assert.equal(childDetail.task.tracker, 'bug');
  assert.equal(childDetail.task.category, 'Интерфейс');
  assert.equal(childDetail.task.target_version, '2.0');
  assert.equal(childDetail.task.start_date, '2026-11-25');
  assert.equal(childDetail.task.due_date, '2026-12-01');
  assert.equal(childDetail.task.estimated_hours, '3.25');
  assert.equal(childDetail.task.done_ratio, 50);
  assert.equal((await member(path)).children[0].id, child.id);
  await member(path, 'PATCH', { ...fields, version: updated.version, parent_id: child.id }, 400);
  const relation = await member(path + '/relations', 'POST', { task_id: other.id, kind: 'blocks' });
  const forward = (await member(path)).relations[0];
  const reverse = (await member(otherPath)).relations[0];
  assert.equal(forward.outgoing, true);
  assert.equal(forward.kind, 'blocks');
  assert.equal(reverse.outgoing, false);
  assert.equal(reverse.task_id, made.id);
  await member(otherPath + '/relations', 'POST', { task_id: made.id, kind: 'blocks' }, 409);
  await member(childPath + '/relations/' + relation.id, 'DELETE', undefined, 404);
  await member(otherPath + '/relations/' + relation.id, 'DELETE');
  assert.deepEqual((await member(path)).relations, []);

  const mergeRequest = await addField(a, 'Merge Request', 'url');
  const customerField = await addField(b, 'Заказчик');
  const existing = await member(path);
  assert.equal(existing.fields.find(item => item.id === mergeRequest.id).kind, 'url');
  assert.equal(existing.task.custom_values[mergeRequest.id], undefined);
  const otherDetail = await member(b + '/tasks/' + other.id);
  assert.equal(otherDetail.fields.some(item => item.id === mergeRequest.id), false);
  assert.equal(otherDetail.fields.find(item => item.id === customerField.id).name, 'Заказчик');
  await member('/task-fields', 'GET', undefined, 403);
  const sharedField = await admin('/task-fields', 'POST', { name: 'Компонент', kind: 'text', required: false });
  assert.equal((await member(path)).fields.some(item => item.id === sharedField.id), true);
  assert.equal((await member(otherPath)).fields.some(item => item.id === sharedField.id), true);
  await admin(a + '/fields/' + sharedField.id, 'PATCH', { archived: true }, 404);
  await admin(a + '/fields', 'POST', { name: 'Компонент', kind: 'text', required: false }, 409);
  const value = 'https://example.test/project/merge_requests/42';
  const linkValues = { ...fields.custom_values, [mergeRequest.id]: value };
  await member(path, 'PATCH', { ...fields, version: existing.task.version,
    custom_values: { ...linkValues, [mergeRequest.id]: 'javascript:alert(1)' } }, 400);
  await member(path, 'PATCH', { ...fields, version: existing.task.version, custom_values: linkValues });
  assert.equal((await member(path)).task.custom_values[mergeRequest.id], value);
  await admin(b, 'PATCH', { name: 'Проект Б', builtin_fields: {
    customer: { visible: true, required: false },
  } }, 409);

  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const file = await member(path + '/attachments/files', 'POST', gif);
  assert.equal(file.name, 'Скриншот.gif');
  assert.equal(file.mime, 'image/gif');
  const link = await member(path + '/attachments/links', 'POST', { name: 'Требования', url: 'https://example.test/requirements' });
  assert.equal(link.url, 'https://example.test/requirements');
  await member(path + '/attachments/links', 'POST', { url: 'javascript:alert(1)' }, 400);
  assert.equal((await admin(path)).attachments.length, 2);

  const filePath = path + '/attachments/' + file.id;
  const download = await admin(filePath);
  assert.deepEqual(download.bytes, gif);
  assert.equal(download.headers.get('content-type'), 'image/gif');
  assert.match((await admin(filePath + '?download=1')).headers.get('content-disposition'), /^attachment;/);
  await member(b + '/tasks/' + made.id + '/attachments/' + file.id, 'GET', undefined, 404);
  await member(path + '/attachments/' + link.id, 'DELETE');
  assert.equal((await member(path)).attachments.length, 1);

  await guest('/logout', 'POST');
  await guest(filePath, 'GET', undefined, 401);
  await member(path, 'DELETE');
  await member(path, 'GET', undefined, 404);
  await member(filePath, 'GET', undefined, 404);
  assert.equal((await member(childPath)).task.parent_id, null);
  await member(childPath, 'DELETE');
  assert.equal((await member(a)).tasks.length, 0);
});
