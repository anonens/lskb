// Admin login: one password, then a signed HttpOnly cookie that lasts 30 days.
//
// Which password works (the first that is set):
//   1. ADMIN_PASSWORD       — Vercel → Settings → Environment Variables (to change the password)
//   2. ADMIN_PASSWORD_HASH  — the same, but stored as a scrypt hash
//   3. the password chosen for this site when it was prepared. Only its salted scrypt hash is below,
//      never the password itself.
// Sessions are signed with SESSION_SECRET if set (16+ characters); otherwise with a key derived from
// ADMIN_PASSWORD, or, when the built-in password is used, with a random key kept privately in the
// data store (lib/store.js → readSessionKey). Changing the password therefore signs everybody out.
import crypto from 'node:crypto';
import { readSessionKey } from './store.js';

const BUILT_IN_HASH = 'scrypt$16384$8$1$_kXd7zle-h73uDQVTKEhtg$qW6_-Hev9HTgNjCWUOENaORIipp79xdoBG0742vco_Y';
const COOKIE = 'juz_admin';
const DAYS = 30;

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || BUILT_IN_HASH);
}

function scryptMatches(candidate, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(candidate || ''), Buffer.from(salt, 'base64url'), want.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(got, want);
}

export function checkPassword(candidate) {
  if (process.env.ADMIN_PASSWORD) {
    const a = crypto.createHash('sha256').update(String(candidate || '')).digest();
    const b = crypto.createHash('sha256').update(String(process.env.ADMIN_PASSWORD)).digest();
    return crypto.timingSafeEqual(a, b);
  }
  return scryptMatches(candidate, process.env.ADMIN_PASSWORD_HASH || BUILT_IN_HASH);
}

async function signingKey() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length >= 16) return s;
  if (process.env.ADMIN_PASSWORD) return crypto.createHash('sha256').update('juz40-session:' + process.env.ADMIN_PASSWORD).digest('hex');
  return 'juz40-session:' + (process.env.ADMIN_PASSWORD_HASH || BUILT_IN_HASH) + ':' + (await readSessionKey());
}
const sign = async (value) => crypto.createHmac('sha256', await signingKey()).update(value).digest('base64url');

const secureFlag = () => (process.env.VERCEL ? '; Secure' : '');

export async function sessionCookie() {
  const exp = Date.now() + DAYS * 864e5;
  return `${COOKIE}=${exp}.${await sign(`admin.${exp}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secureFlag()}`;
}

export function clearedCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export async function isAdmin(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)juz_admin=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  let good;
  try {
    good = await sign(`admin.${exp}`);
  } catch {
    return false;
  }
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

// A small brute-force brake for the login route (kept per server instance).
const attempts = new Map();
export function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  attempts.set(ip, list);
  return list.length >= 8;
}
export function noteFailedAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
  if (attempts.size > 5000) attempts.clear();
}
