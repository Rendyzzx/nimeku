// Dipanggil oleh bot WhatsApp (di Pterodactyl) secara berkala (mis. tiap 5-10
// detik) untuk mengecek apakah ada video baru yang harus dikirim.
// Bot mengambil isi video langsung dari GitHub Contents API pakai GITHUB_PAT
// miliknya sendiri (path dikasih di response ini) — bukan lewat endpoint ini,
// biar bandwidth video tidak numpang lewat Vercel Function.
//
// ==== ENV VAR ====
//   BOT_SECRET  -> string rahasia bebas, HARUS SAMA dengan yang dipakai bot.
//                  Dikirim bot lewat header "x-bot-secret".

import { getStatusQueueFile } from './_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const secret = req.headers['x-bot-secret'];
  if (!process.env.BOT_SECRET || secret !== process.env.BOT_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { items } = await getStatusQueueFile();
    const pending = items
      .filter(i => i.status === 'pending')
      .map(i => ({ id: i.id, phone: i.phone, path: i.path, uploadedAt: i.uploadedAt }));

    return res.status(200).json({ success: true, items: pending });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
