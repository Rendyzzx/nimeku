// Tracking request gratis per IP — 10 request gratis per hari, habis itu butuh
// token seller. Data disimpan di freemium.json (GitHub), reset tiap hari (UTC).
// Pakai deteksi IP biar gak curang dengan pindah browser/incognito.
//
// Tidak perlu env var tambahan — otomatis pakai repo yang sama dengan tokens.json
// (file freemium.json). Kalau mau terpisah, set GITHUB_FREEMIUM_PATH.

import { getFreemiumFile, saveFreemiumFile } from './_lib/github.js';
import { notifyError } from './_lib/telegram.js';

const FREE_LIMIT = 10;

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function getTodayString() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Jangan cache — tiap request harus cek IP terbaru.
  res.setHeader('Cache-Control', 'no-store');

  try {
    const ip = getClientIp(req);
    const today = getTodayString();

    const { visitors, sha } = await getFreemiumFile();

    let visitor = visitors[ip] || { count: 0, date: today };

    // Reset kalau ganti hari
    if (visitor.date !== today) {
      visitor = { count: 0, date: today };
    }

    const remaining = FREE_LIMIT - visitor.count;

    if (remaining > 0) {
      // Masih ada gratis — tambah count, simpan
      visitor.count += 1;
      visitors[ip] = visitor;

      // Simpan ke GitHub (best-effort, jangan block kalau gagal)
      try {
        await saveFreemiumFile(visitors, sha, `Free access: ${ip} (${visitor.count}/${FREE_LIMIT})`);
      } catch (saveErr) {
        // Kalau gagal simpan (race condition dll), tetap kasih akses
        console.error('Freemium save error:', saveErr.message);
      }

      return res.status(200).json({
        success: true,
        free: true,
        remaining: FREE_LIMIT - visitor.count,
        limit: FREE_LIMIT
      });
    } else {
      // Gratis habis — butuh token
      return res.status(200).json({
        success: true,
        free: false,
        remaining: 0,
        limit: FREE_LIMIT,
        requiresToken: true
      });
    }
  } catch (e) {
    // Kalau backend error, kasih akses (jangan block user karena infra error)
    await notifyError(req, { action: 'Freemium check', error: e });
    return res.status(200).json({
      success: true,
      free: true,
      remaining: FREE_LIMIT,
      limit: FREE_LIMIT,
      fallback: true
    });
  }
}
