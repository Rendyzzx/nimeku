// Verifikasi token seller + tracking limit pemakaian. Daftar & sisa limit
// token disimpan di file tokens.json di GitHub, dikelola lewat bot Telegram
// (lihat api/bot.js) — jadi kamu bisa buat token baru / ubah limit tanpa
// deploy ulang ke Vercel.
//
// ==== CARA SETUP ====
// 1. Buat file tokens.json di repo GitHub kamu (boleh mulai dari file kosong
//    berisi {"tokens":[]} — bot Telegram akan mengisinya).
// 2. Di Vercel → Project Settings → Environment Variables:
//      GITHUB_TOKENS_PATH = USERNAME/REPO/BRANCH/tokens.json
//      GITHUB_PAT         = ghp_xxxxxxxxxxxxxxxxxxxx  (scope "repo", READ + WRITE)
//
// PAT hanya disimpan sebagai environment variable di server Vercel — tidak
// pernah dikirim ke browser client.
//
// Format tokens.json:
//   { "tokens": [ { "token": "ABC123", "limit": 100, "used": 3 } ] }
//   limit = -1 artinya unlimited.

import { notifyTelegram, notifyError } from './_lib/telegram.js';
import { getTokensFile, saveTokensFile } from './_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { token: rawToken } = req.query;
  const token = (rawToken || '').trim();
  if (!token) {
    return res.status(400).json({ success: false, error: 'Token wajib diisi' });
  }

  try {
    const { tokens, sha } = await getTokensFile();
    const entry = tokens.find(t => String(t.token).trim() === token);

    if (!entry) {
      await notifyTelegram(req, {
        action: 'Verifikasi Token Seller',
        detail: { Token: token, Status: 'TIDAK VALID (tidak ditemukan)' }
      });
      return res.status(200).json({ success: false, error: 'Token tidak terdaftar.' });
    }

    const limit = entry.limit ?? -1;
    const used = entry.used || 0;

    if (limit !== -1 && used >= limit) {
      await notifyTelegram(req, {
        action: 'Verifikasi Token Seller',
        detail: { Token: token, Status: `LIMIT HABIS (${used}/${limit})` }
      });
      return res.status(200).json({ success: false, error: 'Limit pemakaian token sudah habis.' });
    }

    // Valid & masih ada sisa limit -> tambah pemakaian, simpan balik ke GitHub.
    entry.used = used + 1;
    await saveTokensFile(tokens, sha, `Pakai token ${token} (${entry.used}/${limit === -1 ? '∞' : limit})`);

    await notifyTelegram(req, {
      action: 'Verifikasi Token Seller',
      detail: { Token: token, Status: 'VALID', Pemakaian: `${entry.used}/${limit === -1 ? 'Unlimited' : limit}` }
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    await notifyError(req, { action: 'Verifikasi Token Seller', error: e, extra: { Token: token } });
    return res.status(500).json({ success: false, error: e.message || 'Gagal memverifikasi token.' });
  }
}
