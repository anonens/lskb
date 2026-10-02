// Small helpers shared by the API routes (work on Vercel and in scripts/dev-server.mjs).

// Reads a JSON body. On Vercel req.body is already parsed (reading it throws on broken JSON);
// in scripts/dev-server.mjs the raw stream is read here.
export async function readBody(req, limit = 4_000_000) {
  let pre;
  try {
    pre = req.body;
  } catch {
    throw httpError(400, 'JSON дұрыс емес.');
  }
  if (pre !== undefined && pre !== null) {
    try {
      if (typeof pre === 'string') return pre ? JSON.parse(pre) : {};
      if (Buffer.isBuffer(pre)) return pre.length ? JSON.parse(pre.toString('utf8')) : {};
    } catch {
      throw httpError(400, 'JSON дұрыс емес.');
    }
    return pre;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Сұраныс тым үлкен.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw httpError(400, 'JSON дұрыс емес.');
  }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.expose = true; // the message is written for the admin and may be shown as is
  e.code = code || (status === 409 ? 'conflict' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'error');
  return e;
}

export function fail(res, e) {
  const status = e && e.status ? e.status : 500;
  if (!(e && e.expose)) console.error(e);
  send(res, status, { error: (e && e.code) || 'error', message: e && e.expose ? e.message : 'Серверде қате шықты. Vercel-дегі жобаның Logs бөлімін қараңыз.' });
}

// State-changing requests must come from the site itself (cookie + SameSite=Lax already blocks most cross-site use).
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  return xf.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}
