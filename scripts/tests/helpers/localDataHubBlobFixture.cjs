// Test-only provider transport. Never imported by application code or deployed.
// The real Blob SDK signs tokens, uploads and reads; this emulates its remote
// service on disk in one owned local harness. It proves no hosted Blob behavior.
/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const STORE = 'pilotproof';
const TOKEN = 'vercel_blob_rw_pilotproof_disposablelocalfixtureonly';
const PRIVATE = `https://${STORE}.private.blob.vercel-storage.com`;
const API = 'https://vercel.com';
function createProvider(root, expectedSha) {
  const boundary = path.resolve(__dirname, '../../../test-results/runs-pilot-acceptance');
  root = path.resolve(root);
  if (!root.startsWith(boundary + path.sep) || !/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error('OWNED_BLOB_DIRECTORY_REQUIRED');
  const filename = key => path.join(root, createHash('sha256').update(key).digest('hex') + '.bin');
  const valid = key => /^org_mapping-proof-org\/importbatch_[a-zA-Z0-9_-]+$/.test(key);
  function metadata(key) {
    if (!valid(key) || !existsSync(filename(key))) return null;
    const bytes = readFileSync(filename(key));
    return { pathname: key, url: `${PRIVATE}/${key}`, downloadUrl: `${PRIVATE}/${key}?download=1`, size: bytes.length,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentDisposition: 'attachment',
      cacheControl: 'private, no-store', uploadedAt: '2026-10-01T00:00:00.000Z', etag: expectedSha };
  }
  function accept(url, authorization, bytes) {
    const target = new URL(url), key = target.searchParams.get('pathname');
    if (target.origin !== API || target.pathname !== '/api/blob/' || !key || !valid(key)) throw new Error('FIXTURE_UPLOAD_SCOPE_INVALID');
    const prefix = `Bearer vercel_blob_client_${STORE}_`;
    if (!authorization?.startsWith(prefix)) throw new Error('FIXTURE_CLIENT_TOKEN_INVALID');
    const decoded = Buffer.from(authorization.slice(prefix.length), 'base64').toString('utf8');
    const dot = decoded.indexOf('.'), signature = decoded.slice(0, dot), encoded = decoded.slice(dot + 1);
    const expected = createHmac('sha256', TOKEN).update(encoded).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('FIXTURE_CLIENT_TOKEN_INVALID');
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!Buffer.isBuffer(bytes) || payload.pathname !== key || payload.allowOverwrite !== false || payload.addRandomSuffix !== false ||
      payload.storeId !== STORE || !Number.isSafeInteger(payload.maximumSizeInBytes) || payload.maximumSizeInBytes < 1 ||
      !Array.isArray(payload.allowedContentTypes) || payload.allowedContentTypes.length !== 1 || payload.allowedContentTypes[0] !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      !Number.isFinite(payload.validUntil) || payload.validUntil <= Date.now() || bytes.length > payload.maximumSizeInBytes ||
      createHash('sha256').update(bytes).digest('hex') !== expectedSha || existsSync(filename(key))) throw new Error('FIXTURE_UPLOAD_REJECTED');
    writeFileSync(filename(key), bytes, { flag: 'wx' }); return metadata(key);
  }
  return { metadata, accept, filename };
}
function install() {
  const db = new URL(process.env.DATABASE_URL || 'about:blank');
  if (process.env.DATAHUB_BROWSER_PROOF !== '1' || !['localhost', '127.0.0.1'].includes(db.hostname) || db.pathname !== '/testdb') throw new Error('OWNED_LOCAL_BLOB_HARNESS_REQUIRED');
  const provider = createProvider(process.env.DATAHUB_PILOT_BLOB_DIRECTORY, process.env.DATAHUB_PILOT_SHA256);
  const { MockAgent, setGlobalDispatcher } = require('undici');
  const agent = new MockAgent(); agent.disableNetConnect(); agent.enableNetConnect(/^(localhost|127\.0\.0\.1)(:\d+)?$/);
  agent.get(API).intercept({ path: /.*/, method: 'GET' }).reply(options => {
    if (new Headers(options.headers).get('authorization') !== `Bearer ${TOKEN}`) return { statusCode: 403, data: '' };
    const key = new URL(options.path, API).searchParams.get('url'), metadata = provider.metadata(key || '');
    return metadata ? { statusCode: 200, data: JSON.stringify(metadata), responseOptions: { headers: { 'content-type': 'application/json' } } }
      : { statusCode: 404, data: JSON.stringify({ error: { code: 'not_found' } }) };
  }).persist();
  agent.get(PRIVATE).intercept({ path: /.*/, method: 'GET' }).reply(options => {
    if (new Headers(options.headers).get('authorization') !== `Bearer ${TOKEN}`) return { statusCode: 403, data: '' };
    const url = new URL(options.path, PRIVATE), key = decodeURIComponent(url.pathname.slice(1)), metadata = provider.metadata(key);
    if (!metadata || url.searchParams.get('cache') !== '0') return { statusCode: 404, data: '' };
    return { statusCode: 200, data: readFileSync(provider.filename(key)), responseOptions: { headers: {
      'content-type': metadata.contentType, 'content-length': String(metadata.size), etag: metadata.etag,
      'last-modified': new Date(metadata.uploadedAt).toUTCString(), 'cache-control': metadata.cacheControl } } };
  }).persist();
  setGlobalDispatcher(agent);
}
if (process.env.DATAHUB_PILOT_UPLOAD_PROOF === '1') install();
module.exports = { createProvider, STORE, TOKEN, API };
