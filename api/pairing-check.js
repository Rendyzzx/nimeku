// Dipanggil status-hd.html saat halaman dibuka, buat cek apakah browser ini
// sudah pernah "buka gembok" admin sebelumnya (cookie session masih ada &
// belum expired) — supaya owner tidak perlu masukin password admin tiap
// kali reload halaman.

import { isPairingUnlocked } from './_lib/pairingAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  return res.status(200).json({ success: true, unlocked: isPairingUnlocked(req) });
}
