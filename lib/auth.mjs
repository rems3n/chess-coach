import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool, userView } from './db.mjs';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'cc_session';
const SESSION_DAYS = 30;

function normalizeEmail(email='') { return String(email).trim().toLowerCase(); }
function cookieMap(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}
export async function verifyPassword(password, salt, expectedHex) {
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters');
  if (password.length > 200) throw new Error('Password is too long');
}
function sessionCookie(token, req) {
  const secure = process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto'] || '').includes('https');
  return [
    SESSION_COOKIE + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=' + (SESSION_DAYS * 24 * 60 * 60)
  ].filter(Boolean).join('; ');
}
export function clearSessionCookie(req) {
  const secure = process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto'] || '').includes('https');
  return [SESSION_COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : '', 'Max-Age=0'].filter(Boolean).join('; ');
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [hash, userId, expiresAt]);
  return token;
}
export async function register(req, {email,password,displayName=''}) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address');
  validatePassword(password);
  const {salt,hash} = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      'INSERT INTO users(id,email,password_salt,password_hash,display_name) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [id, normalized, salt, hash, String(displayName || '').trim().slice(0,80)]
    );
    await pool.query("INSERT INTO user_state(user_id,state) VALUES($1,'{}'::jsonb) ON CONFLICT DO NOTHING", [id]);
    const token = await createSession(id);
    return { user: userView(result.rows[0]), token, cookie: sessionCookie(token, req) };
  } catch (err) {
    if (err && err.code === '23505') throw new Error('An account with that email already exists');
    throw err;
  }
}
export async function login(req, {email,password}) {
  const normalized = normalizeEmail(email);
  const result = await pool.query('SELECT * FROM users WHERE email=$1', [normalized]);
  const row = result.rows[0];
  if (!row || !(await verifyPassword(password || '', row.password_salt, row.password_hash))) throw new Error('Invalid email or password');
  const token = await createSession(row.id);
  return { user: userView(row), token, cookie: sessionCookie(token, req) };
}
export async function currentUser(req) {
  const token = cookieMap(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await pool.query(
    'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',
    [tokenHash(token)]
  );
  return userView(result.rows[0]);
}
export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) { const err = new Error('Authentication required'); err.statusCode = 401; throw err; }
  return user;
}
export async function logout(req) {
  const token = cookieMap(req)[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}
export async function getState(userId) {
  const result = await pool.query('SELECT state,updated_at FROM user_state WHERE user_id=$1', [userId]);
  return result.rows[0] || { state:{}, updated_at:null };
}
export async function putState(userId, state) {
  const payload = state && typeof state === 'object' ? state : {};
  const result = await pool.query(
    'INSERT INTO user_state(user_id,state,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(user_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW() RETURNING updated_at',
    [userId, JSON.stringify(payload)]
  );
  return result.rows[0];
}
export async function updateProfile(userId, {displayName,goals,chesscomUsername}) {
  const fields=[], values=[]; let i=1;
  if (displayName !== undefined) { fields.push('display_name=$' + (i++)); values.push(String(displayName||'').trim().slice(0,80)); }
  if (goals !== undefined) {
    const clean = { next: Math.max(100, Math.min(3500, Number(goals && goals.next) || 1800)), longTerm: Math.max(100, Math.min(3500, Number(goals && goals.longTerm) || 2000)) };
    fields.push('goals=$' + (i++) + '::jsonb'); values.push(JSON.stringify(clean));
  }
  if (chesscomUsername !== undefined) { fields.push('chesscom_username=$' + (i++)); values.push(chesscomUsername ? String(chesscomUsername).trim().slice(0,60) : null); }
  if (!fields.length) { const current = await pool.query('SELECT * FROM users WHERE id=$1', [userId]); return userView(current.rows[0]); }
  values.push(userId);
  const result = await pool.query('UPDATE users SET ' + fields.join(',') + ',updated_at=NOW() WHERE id=$' + i + ' RETURNING *', values);
  return userView(result.rows[0]);
}
