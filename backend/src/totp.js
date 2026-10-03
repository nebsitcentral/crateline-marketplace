// Two-factor sign-in with authenticator apps (TOTP, RFC 6238: HMAC-SHA1, 30-second steps,
// 6 digits) and single-use recovery codes. Secrets are encrypted at rest with AES-256-GCM.
import crypto from 'node:crypto';
import { config } from './config.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(crypto.randomBytes(20));
// The code for one 30-second step. digits=8 is only used to check the RFC test vectors.
export function codeAt(secret, step, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', typeof secret === 'string' ? base32Decode(secret) : secret).update(msg).digest();
  const o = h[h.length - 1] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const stepAt = (ms = Date.now()) => Math.floor(ms / 30e3);
// Accepts the current step and one step either side (clock drift). Returns the matched step, or
// null. Steps at or before lastStep are refused so a code cannot be used twice.
export function verifyCode(secret, code, { now = Date.now(), lastStep = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return null;
  const s = stepAt(now);
  for (const step of [s - 1, s, s + 1]) {
    if (step <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}
export function otpauthUri(secret, account) {
  const label = encodeURIComponent(`Crateline:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Crateline&algorithm=SHA1&digits=6&period=30`;
}

// ---------- recovery codes (shown once; only SHA-256 hashes are kept)
export const newRecoveryCodes = (n = 8) => Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex').toUpperCase(); return h.slice(0, 5) + '-' + h.slice(5); });
export const hashRecovery = c => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

// ---------- encryption at rest
// DATA_ENCRYPTION_KEY (any long random string) is preferred; otherwise a key is derived from
// JWT_SECRET. Changing the key makes stored secrets unreadable, so keep it stable.
const key = () => crypto.createHash('sha256').update('crateline-data:' + (process.env.DATA_ENCRYPTION_KEY || config.jwtSecret)).digest();
export function encrypt(text) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function decrypt(blob) {
  const [v, iv, tag, body] = String(blob).split('.'); if (v !== 'v1') throw new Error('Unknown secret format.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
