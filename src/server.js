import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pool, transaction } from './db.js';
import { digest, hashPassword, token, validEmail, verifyPassword } from './auth.js';

import { HttpError, requireThat, field, readBody } from './http.js';
import { registerTaskRoutes } from './tasks.js';
import { registerProfileRoutes } from './profiles.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

const routes = [];
function route(method, path, access, handler, mode = 'json') {
  routes.push({ method, path: new RegExp('^/api' + path + '$'), access, handler, mode });
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function emailField(value) {
  const email = field(value, 'Email', 254).toLowerCase();
  requireThat(validEmail(email), 400, 'Введите корректный email.');
  return email;
}

function sessionCookie(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)tms_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', 'tms_session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge
    + (process.env.SECURE_COOKIES === '1' ? '; Secure' : ''));
}

async function startSession(res, userId) {
  const value = token();
  await pool.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [digest(value), userId]);
  setCookie(res, value, 604_800);
}

async function currentUser(req) {
  const value = sessionCookie(req);
  if (!value) return null;
  return (await pool.query(
    'SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [digest(value)])).rows[0] ?? null;
}

const attempts = new Map();
function limitAuth(req) {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.until <= now) attempts.delete(key);
  }
  const ip = req.socket.remoteAddress;
  const entry = attempts.get(ip) ?? { count: 0, until: now + 60_000 };
  requireThat(entry.count < 20, 429, 'Слишком много попыток. Попробуйте через минуту.');
  entry.count++;
  attempts.set(ip, entry);
}

const dummyHash = await hashPassword(token());

route('GET', '/session', 'public', async ({ req }) => ({ user: await currentUser(req) }));

route('POST', '/login', 'public', async ({ req, res, body }) => {
  limitAuth(req);
  const email = emailField(body.email);
  requireThat(typeof body.password === 'string' && body.password.length <= 200, 400, 'Введите пароль.');
  const user = (await pool.query('SELECT id, name, role, password_hash FROM users WHERE email = $1', [email])).rows[0];
  const matches = await verifyPassword(body.password, user?.password_hash ?? dummyHash);
  requireThat(matches && user, 401, 'Неверный email или пароль.');
  const previous = sessionCookie(req);
  if (previous) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(previous)]);
  await startSession(res, user.id);
  return { user: { id: user.id, email, name: user.name, role: user.role } };
});

route('POST', '/logout', 'public', async ({ req, res }) => {
  const value = sessionCookie(req);
  if (value) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(value)]);
  setCookie(res, '', 0);
  return {};
});

route('GET', '/invitations/([a-f0-9]{64})', 'public', async ({ args }) => {
  const { rows } = await pool.query(
    'SELECT email FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()', [digest(args[0])]);
  requireThat(rows[0], 404, 'Приглашение недействительно или уже использовано.');
  return rows[0];
});

route('POST', '/invitations/([a-f0-9]{64})', 'public', async ({ req, res, body, args }) => {
  limitAuth(req);
  const name = field(body.name, 'Имя', 100);
  requireThat(typeof body.password === 'string' && body.password.length >= 12 && body.password.length <= 200,
    400, 'Пароль должен содержать от 12 до 200 символов.');
  const key = digest(args[0]);
  const password = await hashPassword(body.password);
  const user = await transaction(async db => {
    const lookup = (await db.query('SELECT email FROM invitations WHERE token_hash = $1', [key])).rows[0];
    requireThat(lookup, 404, 'Приглашение недействительно или уже использовано.');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lookup.email]);
    const invitation = (await db.query(
      'SELECT email FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE', [key])).rows[0];
    requireThat(invitation, 404, 'Приглашение недействительно или уже использовано.');
    const { rows } = await db.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'member') RETURNING id, email, name, role",
      [invitation.email, name, password]);
    await db.query('UPDATE invitations SET accepted_at = now() WHERE token_hash = $1', [key]);
    return rows[0];
  });
  const previous = sessionCookie(req);
  if (previous) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(previous)]);
  await startSession(res, user.id);
  return { user };
});

route('GET', '/team', 'admin', async () => ({
  users: (await pool.query('SELECT id, name, email, role FROM users ORDER BY id')).rows,
  invitations: (await pool.query(
    'SELECT email, expires_at FROM invitations WHERE accepted_at IS NULL AND expires_at > now() ORDER BY expires_at DESC')).rows,
}));

route('POST', '/team/invitations', 'admin', async ({ body, user }) => {
  const email = emailField(body.email);
  const value = token();
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
    const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    requireThat(!exists.rowCount, 409, 'Этот участник уже зарегистрирован.');
    await db.query(
      "INSERT INTO invitations (email, token_hash, created_by) VALUES ($1, $2, $3) ON CONFLICT (email) WHERE accepted_at IS NULL DO UPDATE SET token_hash = EXCLUDED.token_hash, created_by = EXCLUDED.created_by, expires_at = now() + interval '7 days'",
      [email, digest(value), user.id]);
  });
  return { token: value };
});

route('GET', '/users', 'member', async () =>
  (await pool.query('SELECT id, name FROM users ORDER BY name, id')).rows);

route('POST', '/team/users', 'admin', async ({ body }) => {
  const name = field(body.name, 'Имя', 100);
  const email = emailField(body.email);
  requireThat(typeof body.password === 'string' && body.password.length >= 12 && body.password.length <= 200,
    400, 'Пароль должен содержать от 12 до 200 символов.');
  const password = await hashPassword(body.password);
  return transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
    const { rows: [account] } = await db.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'member') RETURNING id, email, name, role",
      [email, name, password]);
    await db.query('DELETE FROM invitations WHERE email = $1 AND accepted_at IS NULL', [email]);
    return account;
  });
});

registerTaskRoutes(route);
registerProfileRoutes(route);

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'self'; form-action 'self'; base-uri 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const asset = req.method === 'GET' && assets.get(
      /^\/projects\/\d+\/tasks\/\d+\/?$/.test(url.pathname) ? '/' : url.pathname);
    if (asset) {
      const data = await readFile(new URL('../public/' + asset[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
      res.end(data);
      return;
    }
    for (const item of routes) {
      if (req.method !== item.method) continue;
      const match = url.pathname.match(item.path);
      if (!match) continue;
      const user = item.access === 'public' ? null : await currentUser(req);
      requireThat(item.access === 'public' || user, 401, 'Войдите в аккаунт.');
      requireThat(item.access !== 'admin' || user.role === 'admin', 403, 'Доступ есть только у администратора.');
      const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) && item.mode === 'json' ? await readBody(req) : undefined;
      const result = await item.handler({ req, res, body, user, args: match.slice(1) });
      if (!res.headersSent) json(res, result, req.method === 'POST' ? 201 : 200);
      return;
    }
    throw new HttpError(404, 'Страница не найдена.');
  } catch (error) {
    if (error instanceof HttpError) return json(res, { error: error.message }, error.status);
    if (error.code === '23505') return json(res, { error: 'Такая запись уже существует.' }, 409);
    if (error.code === '23503') return json(res, { error: 'Связанная запись не найдена.' }, 400);
    console.error(error);
    json(res, { error: 'Ошибка сервера. Попробуйте ещё раз.' }, 500);
  }
});

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
server.listen(port, host, () => console.log('BlackCat Tasks: http://' + host + ':' + server.address().port));
