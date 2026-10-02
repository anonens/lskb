// GET  /api/data  — the site's data. Visitors get only the weeks switched on ("Сайтта"); the admin gets everything.
// PUT  /api/data  — the admin saves: { state, photos, baseRev }. Refused with 409 if the site changed meanwhile.
import crypto from 'node:crypto';
import { readBody, send, fail, httpError, sameOrigin } from '../lib/http.js';
import { isAdmin } from '../lib/auth.js';
import { readData, writeData } from '../lib/store.js';
import { validateState, validatePhotos, publicView } from '../lib/validate.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const admin = await isAdmin(req);
      const { data } = await readData({ fresh: admin });
      return send(res, 200, admin ? { ...data, admin: true } : publicView(data));
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) throw httpError(403, 'Рұқсат жоқ.');
      if (!(await isAdmin(req))) throw httpError(401, 'Әкімші ретінде кіріңіз.');
      const body = await readBody(req);
      const current = await readData({ fresh: true });
      const rev = Number(current.data.state.rev) || 0;
      if (Number(body.baseRev) !== rev) throw httpError(409, 'Сайттың деректері осы уақытта басқа жерден өзгерді.');
      const state = validateState(body.state);
      const photos = validatePhotos(body.photos, state);
      state.rev = rev + 1;
      state.saveId = 'v_' + crypto.randomBytes(5).toString('hex');
      state.updatedAt = new Date().toISOString();
      await writeData({ state, photos }, current.etag);
      return send(res, 200, { state, photos, admin: true });
    }
    res.setHeader('Allow', 'GET, PUT');
    throw httpError(405, 'Бұл әдіске рұқсат жоқ.');
  } catch (e) {
    fail(res, e);
  }
}
