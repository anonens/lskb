// GET    /api/session  — { admin, configured, store }; with ?check=1 it also reads the store once (read-only)
//                        and reports { storeOk, storeMessage } — the login window shows a problem before you type
// POST   /api/session  — log in with { password }; sets an HttpOnly cookie for 30 days
// DELETE /api/session  — log out
import { readBody, send, fail, httpError, sameOrigin, clientIp } from '../lib/http.js';
import { adminConfigured, checkPassword, isAdmin, sessionCookie, clearedCookie, tooManyAttempts, noteFailedAttempt } from '../lib/auth.js';
import { storeStatus, readData } from '../lib/store.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const out = { admin: await isAdmin(req), configured: adminConfigured(), store: storeStatus() };
      if (new URL(req.url, 'http://local').searchParams.get('check') === '1' && out.store !== 'local') {
        try {
          if (out.store === 'missing') throw new Error('missing');
          await readData({ fresh: true });
          out.storeOk = true;
        } catch (e) {
          out.storeOk = false;
          out.storeMessage = e && e.expose ? e.message : 'Деректер қоймасы (Blob) бұл жобаға қосылмаған. Vercel → Storage → дүкен → Projects → Connect Project, содан кейін Redeploy (README, 3–4-қадам).';
        }
      }
      return send(res, 200, out);
    }
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
