// Dipanggil bot WA setelah selesai mencoba kirim satu video.
// Body: { "id": "...", "success": true|false, "error": "..." (opsional) }

import { getStatusQueueFile, saveStatusQueueFile } from './_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const secret = req.headers['x-bot-secret'];
  if (!process.env.BOT_SECRET || secret !== process.env.BOT_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { id, success: sendOk, error: sendErr } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'id wajib diisi' });

  try {
    const { items, sha } = await getStatusQueueFile();
    const entry = items.find(i => i.id === id);
    if (!entry) return res.status(404).json({ success: false, error: 'Item tidak ditemukan' });

    entry.status = sendOk === false ? 'failed' : 'sent';
    entry.sentAt = new Date().toISOString();
    if (sendErr) entry.error = String(sendErr).slice(0, 300);

    await saveStatusQueueFile(items, sha, `Tandai ${id} sebagai ${entry.status}`);
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
