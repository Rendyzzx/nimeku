// Dipanggil bot WA begitu event connection.update Baileys statusnya "open"
// (artinya pairing sukses & sesi aktif).

import { getPairingFile, savePairingFile } from './_lib/github.js';
import { notifyTelegram } from './_lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const secret = req.headers['x-bot-secret'];
  if (!process.env.BOT_SECRET || secret !== process.env.BOT_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { pairing, sha } = await getPairingFile();
    pairing.status = 'paired';
    pairing.pairedAt = new Date().toISOString();
    pairing.code = '';
    await savePairingFile(pairing, sha, `Bot WA berhasil paired: ${pairing.phone}`);

    await notifyTelegram(req, { action: 'Bot WA Berhasil Pairing', detail: { Nomor: pairing.phone } });

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
