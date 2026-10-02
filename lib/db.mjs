import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

export async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  await pool.query(
    "CREATE TABLE IF NOT EXISTS users (" +
    " id UUID PRIMARY KEY," +
    " email TEXT NOT NULL UNIQUE," +
    " password_salt TEXT NOT NULL," +
    " password_hash TEXT NOT NULL," +
    " display_name TEXT NOT NULL DEFAULT ''," +
    " chesscom_username TEXT," +
    " goals JSONB NOT NULL DEFAULT '{\"next\":1800,\"longTerm\":2000}'::jsonb," +
    " created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
    " updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ");" +
    " CREATE TABLE IF NOT EXISTS sessions (" +
    " token_hash TEXT PRIMARY KEY," +
    " user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE," +
    " expires_at TIMESTAMPTZ NOT NULL," +
    " created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ");" +
    " CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);" +
    " CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);" +
    " CREATE TABLE IF NOT EXISTS user_state (" +
    " user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE," +
    " state JSONB NOT NULL DEFAULT '{}'::jsonb," +
    " updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ");"
  );
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
}

export function userView(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name || '',
    chesscom_username: row.chesscom_username || null,
    goals: row.goals || { next: 1800, longTerm: 2000 },
    created_at: row.created_at
  };
}
