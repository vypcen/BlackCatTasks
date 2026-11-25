import { readFile, readdir } from 'node:fs/promises';
import { pool, transaction } from './db.js';
import { hashPassword, validEmail } from './auth.js';
import { seedDemo } from './demo.js';

try {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(67392001)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const { rows } = await db.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(row => row.name));
    const directory = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      if (applied.has(name)) continue;
      await db.query(await readFile(new URL(name, directory), 'utf8'));
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
  });

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Администратор' } = process.env;
  if (ADMIN_EMAIL || ADMIN_PASSWORD) {
    await transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(67392001)');
      const { rowCount } = await db.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
      if (rowCount) return;
      const email = ADMIN_EMAIL?.trim().toLowerCase();
      if (!validEmail(email) || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 200 || !ADMIN_NAME.trim() || ADMIN_NAME.length > 100) {
        throw new Error('Укажите корректные ADMIN_EMAIL, ADMIN_NAME и пароль длиной 12–200 символов.');
      }
      await db.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [ADMIN_NAME.trim(), email, await hashPassword(ADMIN_PASSWORD), 'admin']);
    });
  }

  if (process.argv.includes('--demo')) await seedDemo();
  console.log('Подготовка базы завершена.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
