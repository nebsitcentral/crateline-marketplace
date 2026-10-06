// File storage for deliveries, evidence and message attachments (Cloudflare R2, S3-compatible).
// Files are never public and never pass through this API: the browser uploads straight to the
// bucket with a short-lived signed URL, and downloads with another one that the API hands out
// only after checking the caller may see the file.
import crypto from 'node:crypto';
import { config } from './config.js';

export const MAX_FILE_BYTES = 60 * 1048576;
export const BLOCKED_EXT = /\.(exe|bat|cmd|scr|js|msi)$/i;
export const UPLOAD_TTL_S = 15 * 60;
export const DOWNLOAD_TTL_S = 5 * 60;

const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
// RFC 3986 encoding, as AWS Signature Version 4 requires.
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// A signed URL (AWS Signature Version 4, query-string form). Only the host header is signed.
export function presign({ method, host, path, query = {}, accessKeyId, secret, region, expires, at = new Date() }) {
  const stamp = at.toISOString().replace(/[-:]|\.\d{3}/g, ''); const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const q = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': stamp, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const qs = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const uri = path.split('/').map(enc).join('/');
  const request = [method, uri, qs, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const key = ['aws4_request'].reduce(hmac, hmac(hmac(hmac('AWS4' + secret, day), region), 's3'));
  const signature = hmac(key, ['AWS4-HMAC-SHA256', stamp, scope, sha256(request)].join('\n')).toString('hex');
  return `https://${host}${uri}?${qs}&X-Amz-Signature=${signature}`;
}

// putUrl / getUrl return signed URLs for the browser; head and remove are called by the API.
export function r2Storage({ accountId = config.r2.accountId, accessKeyId = config.r2.accessKeyId, secret = config.r2.secret, bucket = config.r2.bucket, fetchImpl = fetch } = {}) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = (method, key, expires, query) => presign({ method, host, path: `/${bucket}/${key}`, query, accessKeyId, secret, region: 'auto', expires });
  return {
    name: 'r2',
    putUrl: key => url('PUT', key, UPLOAD_TTL_S),
    getUrl: (key, name) => url('GET', key, DOWNLOAD_TTL_S, { 'response-content-disposition': `attachment; filename="${name.replace(/[^\w. -]/g, '_')}"` }),
    // The stored size, or null if nothing was uploaded under this key.
    async head(key) {
      const res = await fetchImpl(url('HEAD', key, 60), { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`File storage refused the request (${res.status}).`);
      return { size: Number(res.headers.get('content-length')) };
    },
    async remove(key) { const res = await fetchImpl(url('DELETE', key, 60), { method: 'DELETE' }); if (!res.ok && res.status !== 404) throw new Error(`File storage refused the request (${res.status}).`); },
  };
}
// Test storage: `objects` maps key -> size; a test "uploads" by setting an entry.
export function memoryStorage() {
  const s = { name: 'memory', objects: new Map(),
    putUrl: key => 'memory://put/' + key, getUrl: (key, name) => `memory://get/${key}?name=${name}`,
    async head(key) { return s.objects.has(key) ? { size: s.objects.get(key) } : null; },
    async remove(key) { s.objects.delete(key); } };
  return s;
}
export function createStorage() { return config.fileStorage === 'r2' ? r2Storage() : null; }
export const filesEnabled = () => config.fileStorage !== 'off';

// File ids referenced anywhere in a view: attachments are stored as { id, name, size }.
export function fileIdsIn(view) {
  const ids = new Set();
  const walk = v => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.id === 'string' && v.id.startsWith('FL-') && 'size' in v) ids.add(v.id);
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  };
  walk(view); return ids;
}
