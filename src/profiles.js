import { pool, transaction } from './db.js';
import { field, id, requireThat } from './http.js';
import { choice, fieldDefinition, customValues } from './custom-fields.js';

const profileLock = 67392002;
const roleLock = 67392003;
const profilePath = '/profiles/(\\d+)';

function allowed(user, targetId) {
  requireThat(user.id === targetId || user.role === 'admin', 403, 'Профиль доступен владельцу и администратору.');
}

async function getFields(db) {
  return (await db.query('SELECT id, name, kind, required, options, archived_at FROM user_fields ORDER BY id')).rows;
}

async function getProfile(db, targetId) {
  const { rows: [profile] } = await db.query(
    'SELECT id, name, email, role, job_title, bio, custom_values FROM users WHERE id = $1', [targetId]);
  requireThat(profile, 404, 'Пользователь не найден.');
  return profile;
}

function checkName(name) {
  const reserved = ['имя', 'email', 'роль', 'должность', 'о себе'];
  requireThat(!reserved.includes(name.toLocaleLowerCase('ru')), 409, 'Это название уже используется в профиле.');
}

export function registerProfileRoutes(route) {
  route('PATCH', '/team/users/(\\d+)/role', 'admin', async ({ args, body, user }) => {
    const targetId = id(args[0]);
    const role = choice(body.role, ['admin', 'member'], 'Роль');
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [roleLock]);
      const actor = await getProfile(db, user.id);
      requireThat(actor.role === 'admin', 403, 'Доступ есть только у администратора.');
      const target = await getProfile(db, targetId);
      if (target.role === 'admin' && role === 'member') {
        const { rows: [admins] } = await db.query("SELECT count(*)::int AS count FROM users WHERE role = 'admin'");
        requireThat(admins.count > 1, 409, 'В команде должен остаться хотя бы один администратор.');
      }
      await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
      return { id: targetId, role };
    });
  });

  route('GET', profilePath, 'member', async ({ args, user }) => {
    const targetId = id(args[0]);
    allowed(user, targetId);
    const [profile, fields] = await Promise.all([getProfile(pool, targetId), getFields(pool)]);
    return { profile, fields: fields.filter(item => !item.archived_at) };
  });

  route('PATCH', profilePath, 'member', async ({ args, body, user }) => {
    const targetId = id(args[0]);
    allowed(user, targetId);
    const name = field(body.name, 'Имя', 100);
    const job = field(body.job_title, 'Должность', 120, false);
    const bio = field(body.bio, 'О себе', 4000, false);
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [profileLock]);
      const profile = await getProfile(db, targetId);
      const values = customValues(await getFields(db), body.custom_values, profile.custom_values);
      await db.query('UPDATE users SET name = $1, job_title = $2, bio = $3, custom_values = $4 WHERE id = $5',
        [name, job, bio, values, targetId]);
      return { id: targetId, name };
    });
  });

  route('GET', '/profile-fields', 'admin', () => getFields(pool));

  route('POST', '/profile-fields', 'admin', async ({ body }) => {
    const definition = fieldDefinition(body);
    checkName(definition[0]);
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [profileLock]);
      const fields = await getFields(db);
      requireThat(fields.filter(item => !item.archived_at).length < 30, 409, 'В профиле может быть до 30 активных дополнительных полей.');
      const { rows: [created] } = await db.query(
        'INSERT INTO user_fields (name, kind, required, options) VALUES ($1, $2, $3, $4) RETURNING id', definition);
      return created;
    });
  });

  route('PATCH', '/profile-fields/(\\d+)', 'admin', async ({ args, body }) => {
    const fieldId = id(args[0]);
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [profileLock]);
      const fields = await getFields(db);
      const previous = fields.find(item => item.id === fieldId);
      requireThat(previous, 404, 'Дополнительное поле не найдено.');
      if (typeof body.archived === 'boolean') {
        requireThat(body.archived || !previous.archived_at || fields.filter(item => !item.archived_at).length < 30,
          409, 'В профиле может быть до 30 активных дополнительных полей.');
        await db.query('UPDATE user_fields SET archived_at = CASE WHEN $1 THEN now() END WHERE id = $2', [body.archived, fieldId]);
      } else {
        const [name, , required, options] = fieldDefinition(body, previous);
        checkName(name);
        await db.query('UPDATE user_fields SET name = $1, required = $2, options = $3 WHERE id = $4', [name, required, options, fieldId]);
      }
      return { id: fieldId };
    });
  });
}
