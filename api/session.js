// GET    /api/session  — { admin, configured }
// POST   /api/session  — log in with { password }; sets an HttpOnly cookie for 30 days
// DELETE /api/session  — log out
import { readBody, send, fail, httpError, sameOrigin, clientIp } from '../lib/http.js';
import { adminConfigured, checkPassword, isAdmin, sessionCookie, clearedCookie, tooManyAttempts, noteFailedAttempt } from '../lib/auth.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, { admin: await isAdmin(req), configured: adminConfigured() });
    if (!sameOrigin(req)) throw httpError(403, 'Рұқсат жоқ.');
    if (req.method === 'POST') {
      if (!adminConfigured()) throw httpError(503, 'Сайтта әкімші құпиясөзі бапталмаған (ADMIN_PASSWORD).', 'not_configured');
      const ip = clientIp(req);
      if (tooManyAttempts(ip)) throw httpError(429, 'Тым көп әрекет. Біраз уақыттан кейін қайталаңыз.', 'rate_limited');
      const { password } = await readBody(req, 10_000);
      if (!checkPassword(password)) {
        noteFailedAttempt(ip);
        await pause(700);
        throw httpError(401, 'Құпиясөз қате.');
      }
      return send(res, 200, { admin: true }, { 'Set-Cookie': await sessionCookie() });
    }
    if (req.method === 'DELETE') return send(res, 200, { admin: false }, { 'Set-Cookie': clearedCookie() });
    res.setHeader('Allow', 'GET, POST, DELETE');
    throw httpError(405, 'Бұл әдіске рұқсат жоқ.');
  } catch (e) {
    fail(res, e);
  }
}
