// Checks /api/sapaline: admin-only access, the "not configured" path, and a direct fetch against a
// stand-in SapaLine (a tiny local server that answers like SapaLine's Supabase project). No network.
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'test-' + crypto.randomBytes(9).toString('base64url');

// Stand-in SapaLine: enough of the Supabase auth + REST surface for api/sapaline.js.
function fakeSapaline() {
  const periods = {
    smart: [{ id: 'p_s3', month: 3, week: 4 }, { id: 'p_s4', month: 4, week: 1 }],
    junior: [{ id: 'p_j4', month: 4, week: 1 }],
  };
  const rows = {
    // smart · math · latest week (p_s4)
    'smart|math|p_s4': [
      { id: 11, position: 0, lesson_date: '2026-10-12', time_from: '10:00:00', teacher: 'Қуаныш Нұрдәулет', stream: 'МАТ-21',
        survey_auto: { unady: 70, ortasha: 20, unamady: 10, jalpy: 100, qatysty: 80 }, survey: { unady: 72 } },
      { id: 12, position: 1, lesson_date: '2026-10-13', time_from: '11:30:00', teacher: 'Бекет ағай', stream: 'МАТ-22',
        survey_auto: {}, survey: { jalpy: 20, qatysty: 18 } }, // attendance only, no survey counts
    ],
  };
  let gotToken = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const reply = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/auth/v1/token') {
      let raw = ''; for await (const c of req) raw += c;
      const { email, password } = JSON.parse(raw || '{}');
      if (email === 'svc@sapaline.kz' && password === 'secret') { gotToken = 'tok_' + crypto.randomBytes(4).toString('hex'); return reply(200, { access_token: gotToken, expires_in: 3600 }); }
      return reply(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/rest/v1/live_sabaq_periods') {
      const div = (url.searchParams.get('division') || '').replace('eq.', '');
      return reply(200, periods[div] || []);
    }
    if (url.pathname === '/rest/v1/live_sabaq_rows') {
      const div = (url.searchParams.get('division') || '').replace('eq.', '');
      const subj = (url.searchParams.get('subject') || '').replace('eq.', '');
      const pid = (url.searchParams.get('period_id') || '').replace('eq.', '');
      return reply(200, rows[`${div}|${subj}|${pid}`] || []);
    }
    reply(404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}`, token: () => gotToken })));
}

async function start(port, extra) {
  const env = { ...process.env, PORT: String(port), ADMIN_PASSWORD: PASSWORD, ADMIN_PASSWORD_HASH: '', SESSION_SECRET: '', VERCEL: '', BLOB_STORE_ID: '', BLOB_READ_WRITE_TOKEN: '', LOCAL_DATA_DIR: path.join(ROOT, '.data-sapatest-' + port), ...extra };
  const child = spawn(process.execPath, ['scripts/dev-server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${port}/api/session`)).ok) return { child, log: () => log }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('server did not start\n' + log);
}

async function adminCookie(base) {
  const r = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ password: PASSWORD }) });
  return r.headers.get('set-cookie').split(';')[0];
}

const fake = await fakeSapaline();
const cleanups = [];
try {
  // ---- configured: a working service account ----
  const base = 'http://localhost:3911';
  const srv = await start(3911, { SAPALINE_URL: fake.url, SAPALINE_ANON_KEY: 'anon', SAPALINE_EMAIL: 'svc@sapaline.kz', SAPALINE_PASSWORD: 'secret' });
  cleanups.push(() => srv.child.kill());
  try {
    // locked to admins
    assert.equal((await fetch(base + '/api/sapaline')).status, 401, 'GET needs admin');
    const cookie = await adminCookie(base);

    // GET lists the weeks SapaLine has, newest first
    let r = await fetch(base + '/api/sapaline', { headers: { Cookie: cookie } });
    let j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.configured, true);
    assert.deepEqual(j.lines.smart.map((p) => p.label), ['4-АЙ 1-АПТА', '3-АЙ 4-АПТА'], 'smart weeks, latest first');
    assert.deepEqual(j.lines.junior.map((p) => p.label), ['4-АЙ 1-АПТА']);

    // POST without a week → latest; rows mapped to the bookmarklet's JSON shape
    r = await fetch(base + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ subject: 'math', line: 'smart' }) });
    j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.source, 'sapaline');
    assert.equal(j.v, 2);
    assert.equal(j.subject, 'math');
    assert.equal(j.line, 'smart');
    assert.equal(j.period, '4-АЙ 1-АПТА', 'defaults to the latest week');
    assert.equal(j.rows.length, 2);
    // a hand-entered survey value overrides the live one (unady 72 over 70); present/total from qatysty/jalpy
    assert.deepEqual(j.rows[0].survey, { liked: 72, avg: 20, disliked: 10 });
    assert.equal(j.rows[0].present, 80);
    assert.equal(j.rows[0].total, 100);
    assert.equal(j.rows[0].teacher, 'Қуаныш Нұрдәулет');
    assert.equal(j.rows[0].agym, 'МАТ-21');
    assert.equal(j.rows[0].time, '10:00');
    // the attendance-only lesson carries no survey block but keeps present/total
    assert.equal(j.rows[1].survey, undefined, 'no survey block without counts');
    assert.equal(j.rows[1].present, 18);
    assert.equal(j.rows[1].total, 20);

    // a specific past week
    r = await fetch(base + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ subject: 'geo', line: 'smart', month: 3, week: 4 }) });
    j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.subject, 'geometry');
    assert.equal(j.period, '3-АЙ 4-АПТА');
    assert.equal(j.rows.length, 0, 'no geometry rows seeded for that week');

    // a week SapaLine does not have
    r = await fetch(base + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ subject: 'math', line: 'smart', month: 9, week: 9 }) });
    assert.equal(r.status, 404, 'unknown week refused');

    // bad subject / line
    assert.equal((await fetch(base + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ subject: 'x', line: 'smart' }) })).status, 400);
    assert.equal((await fetch(base + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ subject: 'math', line: 'x' }) })).status, 400);
    // cross-site POST refused
    assert.equal((await fetch(base + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' }, body: JSON.stringify({ subject: 'math', line: 'smart' }) })).status, 403);
    assert.ok(fake.token(), 'the service account actually logged in');
    console.log('✓ /api/sapaline direct fetch (service account, faked SapaLine)');
  } catch (e) { console.error(srv.log()); throw e; }

  // ---- not configured: no service account set ----
  const base2 = 'http://localhost:3912';
  const srv2 = await start(3912, { SAPALINE_EMAIL: '', SAPALINE_PASSWORD: '' });
  cleanups.push(() => srv2.child.kill());
  try {
    const cookie = await adminCookie(base2);
    const g = await fetch(base2 + '/api/sapaline', { headers: { Cookie: cookie } });
    assert.equal((await g.json()).configured, false, 'reports not configured');
    const p = await fetch(base2 + '/api/sapaline', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base2 }, body: JSON.stringify({ subject: 'math', line: 'smart' }) });
    assert.equal(p.status, 503, 'POST refused when not configured');
    console.log('✓ /api/sapaline reports when the service account is not set');
  } catch (e) { console.error(srv2.log()); throw e; }

  console.log('All SapaLine checks passed.');
} finally {
  cleanups.forEach((f) => f());
  fake.server.close();
  const fs2 = await import('node:fs');
  for (const p of [3911, 3912]) fs2.rmSync(path.join(ROOT, '.data-sapatest-' + p), { recursive: true, force: true });
}
