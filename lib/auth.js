// Login: a login (email) + password, then a signed HttpOnly cookie that lasts 30 days. The whole site
// is behind this — visitors see nothing until they sign in. There are two roles:
//
//   • viewer — the teachers. One shared login that can only look at the site.
//       login:    VIEWER_LOGIN     (default teachers@sapaline.kz)
//       password: VIEWER_PASSWORD or VIEWER_PASSWORD_HASH, else the built-in hash below.
//   • admin  — may edit everything. Signs in from the same form; the login must match ADMIN_LOGIN.
//       login:    ADMIN_LOGIN      (default mat_geom@juz40onl.com)
//       password: ADMIN_PASSWORD or ADMIN_PASSWORD_HASH, else the password chosen when the site was
//                 prepared (only its salted scrypt hash is in the code, never the password itself).
//
// Sessions are signed with SESSION_SECRET if set (16+ characters); otherwise with a key derived from
// ADMIN_PASSWORD, or, when the built-in password is used, a random key kept privately in the data
// store (lib/store.js → readSessionKey). Changing the admin password therefore signs everybody out.
// Passwords are set on Vercel → Settings → Environment Variables; they are typed in chat here, so
// change them there afterwards.
import crypto from 'node:crypto';
import { readSessionKey } from './store.js';

const BUILT_IN_HASH = 'scrypt$16384$8$1$_kXd7zle-h73uDQVTKEhtg$qW6_-Hev9HTgNjCWUOENaORIipp79xdoBG0742vco_Y';
// scrypt hash of the shared viewer password (knowledge_140). Override with VIEWER_PASSWORD(_HASH).
const VIEWER_BUILT_IN_HASH = 'scrypt$16384$8$1$NdVNGUP6qtqY3PdgIthISQ$FcDxzMJTHzeixRwkWT6EY5MxWXkUWpkSwwCMi04fG4Q';
const ADMIN_LOGIN_DEFAULT = 'mat_geom@juz40onl.com';
const VIEWER_LOGIN_DEFAULT = 'teachers@sapaline.kz';
const COOKIE = 'juz_sess';
const ROLES = ['admin', 'viewer'];
const DAYS = 30;

const email = (v) => String(v || '').trim().toLowerCase();
export const adminLogin = () => email(process.env.ADMIN_LOGIN || ADMIN_LOGIN_DEFAULT);
export const viewerLogin = () => email(process.env.VIEWER_LOGIN || VIEWER_LOGIN_DEFAULT);

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || BUILT_IN_HASH);
}
export function viewerConfigured() {
  return Boolean(process.env.VIEWER_PASSWORD || process.env.VIEWER_PASSWORD_HASH || VIEWER_BUILT_IN_HASH);
}

function scryptMatches(candidate, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(candidate || ''), Buffer.from(salt, 'base64url'), want.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function plainMatches(candidate, plain) {
  const a = crypto.createHash('sha256').update(String(candidate || '')).digest();
  const b = crypto.createHash('sha256').update(String(plain)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function checkPassword(candidate) {
  if (process.env.ADMIN_PASSWORD) return plainMatches(candidate, process.env.ADMIN_PASSWORD);
  return scryptMatches(candidate, process.env.ADMIN_PASSWORD_HASH || BUILT_IN_HASH);
}
export function checkViewerPassword(candidate) {
  if (process.env.VIEWER_PASSWORD) return plainMatches(candidate, process.env.VIEWER_PASSWORD);
  return scryptMatches(candidate, process.env.VIEWER_PASSWORD_HASH || VIEWER_BUILT_IN_HASH);
}

// The role a login + password pair earns, or null. Admin is checked first (a matching admin login and
// password always wins). Both the login and the password must match.
export function resolveRole(login, password) {
  if (email(login) === adminLogin() && checkPassword(password)) return 'admin';
  if (email(login) === viewerLogin() && checkViewerPassword(password)) return 'viewer';
  return null;
}

async function signingKey() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length >= 16) return s;
  if (process.env.ADMIN_PASSWORD) return crypto.createHash('sha256').update('juz40-session:' + process.env.ADMIN_PASSWORD).digest('hex');
  return 'juz40-session:' + (process.env.ADMIN_PASSWORD_HASH || BUILT_IN_HASH) + ':' + (await readSessionKey());
}
const sign = async (value) => crypto.createHmac('sha256', await signingKey()).update(value).digest('base64url');

const secureFlag = () => (process.env.VERCEL ? '; Secure' : '');

export async function sessionCookie(role) {
  if (!ROLES.includes(role)) throw new Error('bad role');
  const exp = Date.now() + DAYS * 864e5;
  return `${COOKIE}=${role}.${exp}.${await sign(`${role}.${exp}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secureFlag()}`;
}

export function clearedCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

// The role carried by a valid session cookie, or null. The signature covers the role, so a viewer
// cookie cannot be edited into an admin one.
export async function sessionRole(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)juz_sess=([^;]+)/);
  if (!m) return null;
  const [role, exp, sig] = m[1].split('.');
  if (!ROLES.includes(role) || !exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  let good;
  try {
    good = await sign(`${role}.${exp}`);
  } catch {
    return null;
  }
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? role : null;
}

export async function isAdmin(req) {
  return (await sessionRole(req)) === 'admin';
}
// Any signed-in user (viewer or admin) — the gate for seeing the site at all.
export async function isViewer(req) {
  return (await sessionRole(req)) !== null;
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
