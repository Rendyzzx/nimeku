// Helper session untuk "gembok" halaman admin pairing.
// Password admin disimpan sebagai env var PAIRING_PASSWORD di Vercel —
// tidak pernah di-hardcode di kode maupun dikirim balik ke browser.
//
// Cara kerja: setelah password cocok, server bikin cookie berisi
// "expiry.signature" (signature = HMAC-SHA256 dari expiry, key = PAIRING_PASSWORD).
// Cookie ini httpOnly (tidak bisa dibaca lewat JS di browser) supaya tidak
// gampang dipalsukan dari console.

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'pairing_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 jam

function sign(expiry) {
  const secret = process.env.PAIRING_PASSWORD || '';
  return createHmac('sha256', secret).update(String(expiry)).digest('hex');
}

export function buildSessionCookie() {
  const expiry = Date.now() + MAX_AGE_SECONDS * 1000;
  const token = `${expiry}.${sign(expiry)}`;
  const secure = process.env.VERCEL ? '; Secure' : ''; // biar tetap jalan pas dev lokal (http)
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

// Return true kalau request bawa cookie session admin yang valid & belum expired.
export function isPairingUnlocked(req) {
  if (!process.env.PAIRING_PASSWORD) return false;
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return false;

  const [expiryStr, sig] = raw.split('.');
  const expiry = Number(expiryStr);
  if (!expiry || !sig || Date.now() > expiry) return false;

  const expected = sign(expiry);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
