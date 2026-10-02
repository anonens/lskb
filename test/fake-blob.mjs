// A stand-in for @vercel/blob used only by test/api.test.mjs (selected with JUZ_BLOB_MODULE).
// It keeps blobs in FAKE_BLOB_DIR and behaves like a private store: ETag-checked writes,
// "already exists" without allowOverwrite, get() → null when missing.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.FAKE_BLOB_DIR;
const BASE = 'https://fake.private.blob.vercel-storage.com/';
export class BlobPreconditionFailedError extends Error {
  constructor() {
    super('Vercel Blob: Precondition failed: ETag mismatch.');
  }
}
const file = (p) => path.join(DIR, encodeURIComponent(p));
async function meta(p) {
  try {
    return JSON.parse(await fs.readFile(file(p) + '.meta', 'utf8'));
  } catch {
    return null;
  }
}
function needPrivate(opts) {
  if (!opts || opts.access !== 'private') throw new Error('Vercel Blob: this store is private, use access: "private".');
  // like the real SDK: without BLOB_STORE_ID / BLOB_READ_WRITE_TOKEN the store must be named in the call
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN && !opts.storeId && !opts.token) throw new Error('Vercel Blob: No blob credentials found.');
}

// the real service checks ifMatch atomically; a queue gives the same guarantee here
let queue = Promise.resolve();
export function put(pathname, body, opts = {}) {
  const run = queue.then(() => putNow(pathname, body, opts));
  queue = run.catch(() => {});
  return run;
}

async function putNow(pathname, body, opts) {
  needPrivate(opts);
  const m = await meta(pathname);
  if (opts.ifMatch && opts.allowOverwrite === false) throw new Error('Vercel Blob: ifMatch and allowOverwrite: false are contradictory.');
  if (opts.ifMatch && (!m || m.etag !== opts.ifMatch)) throw new BlobPreconditionFailedError();
  if (m && !opts.ifMatch && !opts.allowOverwrite) throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  await fs.mkdir(DIR, { recursive: true });
  const etag = '"' + crypto.randomBytes(8).toString('hex') + '"';
  await fs.writeFile(file(pathname), buf);
  await fs.writeFile(file(pathname) + '.meta', JSON.stringify({ etag, contentType: opts.contentType || 'application/octet-stream' }));
  return { pathname, url: BASE + pathname, etag };
}

// Like the real CDN for a compressed response, the content's tag comes back weak (W/"…") — not usable for ifMatch.
export async function get(pathname, opts = {}) {
  needPrivate(opts);
  const m = await meta(pathname);
  if (!m) return null;
  const buf = await fs.readFile(file(pathname));
  return { statusCode: 200, stream: new Response(buf).body, headers: new Headers(), blob: { pathname, url: BASE + pathname, etag: 'W/' + m.etag, contentType: m.contentType, size: buf.length } };
}

export class BlobNotFoundError extends Error {
  constructor() {
    super('Vercel Blob: The requested blob does not exist');
    this.name = 'BlobNotFoundError';
  }
}
export async function head(pathname, opts = {}) {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN && !opts.storeId && !opts.token) throw new Error('Vercel Blob: No blob credentials found.');
  const m = await meta(pathname);
  if (!m) throw new BlobNotFoundError();
  return { pathname, url: BASE + pathname, etag: m.etag, contentType: m.contentType };
}

export async function list({ prefix = '', limit = 1000, storeId, token } = {}) {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN && !storeId && !token) throw new Error('Vercel Blob: No blob credentials found.');
  let names = [];
  try {
    names = await fs.readdir(DIR);
  } catch {}
  const blobs = names
    .filter((n) => !n.endsWith('.meta'))
    .map((n) => decodeURIComponent(n))
    .filter((p) => p.startsWith(prefix))
    .slice(0, limit)
    .map((p) => ({ pathname: p, url: BASE + p }));
  return { blobs, hasMore: false };
}

export async function del(urls, opts = {}) {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN && !opts.storeId && !opts.token) throw new Error('Vercel Blob: No blob credentials found.');
  for (const u of [].concat(urls)) {
    const p = String(u).replace(BASE, '');
    await fs.rm(file(p), { force: true });
    await fs.rm(file(p) + '.meta', { force: true });
  }
}
