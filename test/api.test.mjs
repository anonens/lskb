// End-to-end check of the API: starts scripts/dev-server.mjs twice — once with the on-disk store and once
// with a fake private Blob store — and walks through visitor and admin requests.   npm test
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'test-' + crypto.randomBytes(9).toString('base64url'); // a throwaway value for this run only
// a valid 1×1 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function start(port, extra) {
  const env = { ...process.env, PORT: String(port), ADMIN_PASSWORD: PASSWORD, ADMIN_PASSWORD_HASH: '', SESSION_SECRET: '', VERCEL: '', BLOB_STORE_ID: '', BLOB_READ_WRITE_TOKEN: '', ...extra };
  const child = spawn(process.execPath, ['scripts/dev-server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/session`)).ok) return { child, log: () => log };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('server did not start\n' + log);
}

async function suite(label, port, extra, checkStore) {
  const srv = await start(port, extra);
  const base = `http://localhost:${port}`;
  const origin = { Origin: base };
  const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), headers: r.headers });
  const call = (method, p, { body, cookie, headers } = {}) =>
    fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(json);
  try {
    // pages
    for (const p of ['/', '/admin']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.match(await r.text(), /HOST_MODE = "server"/, p);
    }
    assert.equal((await fetch(base + '/photos/t_beket.jpg')).headers.get('content-type'), 'image/jpeg');

    // visitor view: only weeks switched on
    let r = await call('GET', '/api/data');
    assert.equal(r.status, 200);
    assert.equal(r.body.state._public, true);
    const pubWeeks = r.body.state.months.flatMap((m) => m.weeks);
    assert.ok(pubWeeks.length > 0 && pubWeeks.every((w) => w.published), 'only published weeks');
    assert.ok(Object.keys(r.body.state.results).every((w) => pubWeeks.some((x) => x.id === w)), 'no draft results');

    // login
    assert.deepEqual((await call('GET', '/api/session')).body, { admin: false, configured: true });
    assert.equal((await call('POST', '/api/session', { body: { password: 'nope' }, headers: origin })).status, 401);
    assert.equal((await call('POST', '/api/session', { body: { password: PASSWORD }, headers: { Origin: 'https://evil.example' } })).status, 403);
    r = await call('POST', '/api/session', { body: { password: PASSWORD }, headers: origin });
    assert.equal(r.status, 200);
    const setCookie = r.headers.get('set-cookie');
    assert.match(setCookie, /juz_admin=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await call('GET', '/api/session', { cookie })).body.admin, true);
    assert.equal((await call('GET', '/api/session', { cookie: cookie.slice(0, -2) + 'xx' })).body.admin, false, 'tampered cookie');

    // admin view has everything
    r = await call('GET', '/api/data', { cookie });
    const full = r.body;
    assert.equal(full.admin, true);
    assert.ok(!full.state._public);
    assert.ok(full.state.months.flatMap((m) => m.weeks).length >= pubWeeks.length);
    const rev0 = full.state.rev;

    // saving
    const edited = structuredClone(full.state);
    edited.outro.title = 'Тест: ' + label;
    assert.equal((await call('PUT', '/api/data', { body: { state: edited, photos: full.photos, baseRev: rev0 } })).status, 401, 'no cookie');
    assert.equal((await call('PUT', '/api/data', { cookie, body: { state: edited, photos: full.photos, baseRev: rev0 }, headers: { Origin: 'https://evil.example' } })).status, 403, 'cross-site');
    assert.equal((await call('PUT', '/api/data', { cookie, body: { state: edited, photos: full.photos, baseRev: rev0 + 5 }, headers: origin })).status, 409, 'wrong base');
    r = await call('PUT', '/api/data', { cookie, body: { state: edited, photos: full.photos, baseRev: rev0 }, headers: origin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.state.rev, rev0 + 1);
    assert.equal((await call('GET', '/api/data')).body.state.outro.title, 'Тест: ' + label, 'visitors see the save');
    assert.equal((await call('PUT', '/api/data', { cookie, body: { state: edited, photos: full.photos, baseRev: rev0 }, headers: origin })).status, 409, 'stale save refused');
    const pub = (await call('GET', '/api/data')).body;
    assert.equal((await call('PUT', '/api/data', { cookie, body: { state: pub.state, photos: pub.photos, baseRev: rev0 + 1 }, headers: origin })).status, 400, 'visitor copy cannot be saved');
    assert.equal((await call('PUT', '/api/data', { cookie, body: { state: edited, photos: { t_beket: 'data:image/jpeg;base64,AAAA' }, baseRev: rev0 + 1 }, headers: origin })).status, 400, 'inline photo refused');
    const broken = await fetch(base + '/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...origin }, body: '{broken' });
    assert.equal(broken.status, 400, 'broken json');

    // photos
    assert.equal((await call('POST', '/api/photo', { body: { teacherId: 't_beket', dataUrl: 'data:image/jpeg;base64,' + JPEG.toString('base64') }, headers: origin })).status, 401);
    assert.equal((await call('POST', '/api/photo', { cookie, body: { teacherId: 't_beket', dataUrl: 'data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64') }, headers: origin })).status, 400);
    r = await call('POST', '/api/photo', { cookie, body: { teacherId: 't_beket', dataUrl: 'data:image/jpeg;base64,' + JPEG.toString('base64') }, headers: origin });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^\/api\/photo\?p=photos\/t_beket-[a-z0-9]+\.jpg$/);
    const img = await fetch(base + r.body.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await img.arrayBuffer()).equals(JPEG));
    assert.equal((await fetch(base + '/api/photo?p=data/site.json')).status, 404, 'only photos are served');
    const latest = (await call('GET', '/api/data', { cookie })).body;
    r = await call('PUT', '/api/data', { cookie, body: { state: latest.state, photos: { ...latest.photos, t_beket: r.body.url }, baseRev: latest.state.rev }, headers: origin });
    assert.equal(r.status, 200);
    assert.match((await call('GET', '/api/data')).body.photos.t_beket, /^\/api\/photo\?p=photos\//);

    // two saves at the same moment: one wins, the other is told to reload
    const now = (await call('GET', '/api/data', { cookie })).body;
    const twins = await Promise.all([1, 2].map((i) => {
      const s = structuredClone(now.state);
      s.outro.text = 'Параллель ' + i;
      return call('PUT', '/api/data', { cookie, body: { state: s, photos: now.photos, baseRev: now.state.rev }, headers: origin });
    }));
    assert.deepEqual(twins.map((x) => x.status).sort(), [200, 409], 'concurrent saves');

    // logout
    r = await call('DELETE', '/api/session', { cookie, headers: origin });
    assert.match(r.headers.get('set-cookie'), /juz_admin=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);

    checkStore();
    console.log(`✓ ${label}`);
  } catch (e) {
    console.error(`✗ ${label}\n` + srv.log());
    throw e;
  } finally {
    srv.child.kill();
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'juz40-test-'));
const localDir = path.join(tmp, 'local');
const blobDir = path.join(tmp, 'blob');
try {
  await suite('on-disk store (npm run dev)', 3901, { LOCAL_DATA_DIR: localDir }, () => {
    assert.ok(fs.existsSync(path.join(localDir, 'site.json')));
    assert.ok(fs.readdirSync(path.join(localDir, 'history')).length >= 3);
  });
  await suite('private Blob store (as on Vercel, faked)', 3902, { BLOB_STORE_ID: 'store_fake', JUZ_BLOB_MODULE: pathToFileURL(path.join(ROOT, 'test', 'fake-blob.mjs')).href, FAKE_BLOB_DIR: blobDir }, () => {
    const names = fs.readdirSync(blobDir).map(decodeURIComponent);
    assert.ok(names.includes('data/site.json'));
    assert.ok(names.some((n) => n.startsWith('data/history/') && n.endsWith('.json')));
    assert.ok(names.some((n) => /^photos\/t_beket-.*\.jpg$/.test(n)));
  });
  // the password stored only as a scrypt hash (as the built-in one is), sessions signed with a key kept in the store
  const salt = crypto.randomBytes(16);
  const hash = `scrypt$16384$8$1$${salt.toString('base64url')}$${crypto.scryptSync(PASSWORD, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url')}`;
  const blobDir2 = path.join(tmp, 'blob2');
  await suite('password kept as a hash (Blob, faked)', 3903, { ADMIN_PASSWORD: '', ADMIN_PASSWORD_HASH: hash, BLOB_STORE_ID: 'store_fake', JUZ_BLOB_MODULE: pathToFileURL(path.join(ROOT, 'test', 'fake-blob.mjs')).href, FAKE_BLOB_DIR: blobDir2 }, () => {
    assert.ok(fs.readdirSync(blobDir2).map(decodeURIComponent).includes('data/session-key.json'));
  });
  console.log('All API checks passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
