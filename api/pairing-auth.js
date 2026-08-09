// Dipanggil dari panel admin di status-hd.html saat pengunjung memasukkan
// password gembok. Password-nya disetel lewat env var PAIRING_PASSWORD di
// Vercel (Project Settings -> Environment Variables), BUKAN GITHUB_PAT —
// jadi password ini bisa kamu kasih tahu ke diri sendiri tanpa perlu expose
// PAT tiap buka halaman. PAT tetap dipakai server-side sebagai otorisasi
// asli saat form pairing di-submit (lihat api/pairing-request.js).

import { buildSessionCookie, clearSessionCookie } from './_lib/pairingAuth.js';

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ success: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!process.env.PAIRING_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: 'PAIRING_PASSWORD belum diset di Environment Variables Vercel.'
    });
  }

  const { password } = req.body || {};
  if (!password || password !== process.env.PAIRING_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Password salah.' });
  }

  res.setHeader('Set-Cookie', buildSessionCookie());
  return res.status(200).json({ success: true });
}
