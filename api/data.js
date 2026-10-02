// GET  /api/data  — the site's data. Visitors get only the weeks switched on ("Сайтта"); the admin gets everything.
// PUT  /api/data  — the admin saves: { state, photos, baseRev, baseEtag }. Refused with 409 if the site changed meanwhile.
import crypto from 'node:crypto';
import { readBody, send, fail, httpError, sameOrigin } from '../lib/http.js';
import { isAdmin } from '../lib/auth.js';
import { readData, writeData } from '../lib/store.js';
import { validateState, validatePhotos, publicView } from '../lib/validate.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const admin = await isAdmin(req);
      // the admin also gets the version tag (etag) of what was read: the next save quotes it
      const { data, etag } = await readData({ fresh: admin, withEtag: admin });
      return send(res, 200, admin ? { ...data, admin: true, etag } : publicView(data));
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) throw httpError(403, 'Рұқсат жоқ.');
      if (!(await isAdmin(req))) throw httpError(401, 'Әкімші ретінде кіріңіз.');
      const body = await readBody(req);
      let rev, etag;
      if (body && Object.prototype.hasOwnProperty.call(body, 'baseEtag')) {
        // the page says which saved version it edited; the store refuses the save if that is no longer the latest
        if (body.baseEtag !== null && (typeof body.baseEtag !== 'string' || body.baseEtag.length > 200)) throw httpError(400, 'Нұсқа белгісі қате.');
        rev = Number(body.baseRev) || 0;
        etag = body.baseEtag;
      } else {
        // pages loaded before this change send only the revision number
        const current = await readData({ fresh: true, withEtag: true });
        rev = Number(current.data.state.rev) || 0;
        if (Number(body.baseRev) !== rev) throw httpError(409, 'Сайттың деректері осы уақытта басқа жерден өзгерді.');
        etag = current.etag;
      }
      const state = validateState(body.state);
      const photos = validatePhotos(body.photos, state);
      state.rev = rev + 1;
      state.saveId = 'v_' + crypto.randomBytes(5).toString('hex');
      state.updatedAt = new Date().toISOString();
      const newEtag = await writeData({ state, photos }, etag);
      return send(res, 200, { state, photos, admin: true, etag: newEtag });
    }
    res.setHeader('Allow', 'GET, PUT');
    throw httpError(405, 'Бұл әдіске рұқсат жоқ.');
  } catch (e) {
    fail(res, e);
  }
}
