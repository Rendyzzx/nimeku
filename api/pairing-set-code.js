// Dipanggil bot WA setelah sock.requestPairingCode(phone) berhasil.
// Body: { "code": "ABCD1234" }

import { getPairingFile, savePairingFile } from './_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const secret = req.headers['x-bot-secret'];
  if (!process.env.BOT_SECRET || secret !== process.env.BOT_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: 'code wajib diisi' });

  try {
    const { pairing, sha } = await getPairingFile();
    pairing.status = 'code_ready';
    pairing.code = code;
    await savePairingFile(pairing, sha, `Kode pairing siap untuk ${pairing.phone}`);
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
