// GET  /api/photo?p=photos/<name>.jpg  — an uploaded teacher photo (names are unique, so it is cached for a year)
// POST /api/photo  { teacherId, dataUrl }  — the admin uploads a photo (already resized by the browser)
import { readBody, send, fail, httpError, sameOrigin } from '../lib/http.js';
import { isAdmin } from '../lib/auth.js';
import { putPhoto, readPhoto } from '../lib/store.js';

const TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const name = new URL(req.url, 'http://local').searchParams.get('p') || '';
      const photo = await readPhoto(name);
      if (!photo) throw httpError(404, 'Фото табылмады.', 'not_found');
      res.statusCode = 200;
      res.setHeader('Content-Type', photo.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(photo.body);
    }
    if (req.method === 'POST') {
      if (!sameOrigin(req)) throw httpError(403, 'Рұқсат жоқ.');
      if (!(await isAdmin(req))) throw httpError(401, 'Әкімші ретінде кіріңіз.');
      const { teacherId, dataUrl } = await readBody(req);
      if (typeof teacherId !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(teacherId)) throw httpError(400, 'Мұғалім белгісіз.');
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) throw httpError(400, 'Сурет JPG, PNG немесе WEBP болуы керек.');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 1_500_000) throw httpError(413, 'Сурет тым үлкен.');
      const magic = TYPES[m[1]];
      if (!magic.every((b, i) => buf[i] === b)) throw httpError(400, 'Сурет файлы бүлінген.');
      const url = await putPhoto(buf, m[1], teacherId);
      return send(res, 200, { url });
    }
    res.setHeader('Allow', 'GET, POST');
    throw httpError(405, 'Бұл әдіске рұқсат жоқ.');
  } catch (e) {
    fail(res, e);
  }
}
