import pg from 'pg';

pg.types.setTypeParser(1082, value => value); // Keep SQL dates as calendar dates without a timezone.

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', error => console.error('PostgreSQL:', error.message));

export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
