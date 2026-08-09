// Dipanggil dari pairing.html. "pat" di sini BUKAN disimpan sebagai token
// baru — cuma dicocokkan ke GITHUB_PAT yang sudah ada di env var, sebagai
// kunci otorisasi supaya sembarang pengunjung tidak bisa memicu pairing
// ulang bot ke nomor lain. PAT tidak pernah disimpan di GitHub maupun
// dikembalikan ke browser.

import { getPairingFile, savePairingFile } from './_lib/github.js';
import { notifyTelegram, notifyError } from './_lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { phone: rawPhone, pat } = req.body || {};
  const phone = String(rawPhone || '').replace(/\D/g, '');

  if (!phone || phone.length < 8 || phone.length > 15) {
    return res.status(400).json({ success: false, error: 'Nomor WhatsApp tidak valid.' });
  }
  if (!process.env.GITHUB_PAT || pat !== process.env.GITHUB_PAT) {
    return res.status(401).json({ success: false, error: 'PAT tidak cocok.' });
  }

  try {
    const { pairing, sha } = await getPairingFile();
    if (pairing.status === 'paired') {
      return res.status(409).json({
        success: false,
        error: `Bot sudah paired ke ${pairing.phone}. Reset pairing.json manual di GitHub kalau mau pairing ulang.`
      });
    }

    const next = {
      phone,
      status: 'requested',
      code: '',
      requestedAt: new Date().toISOString(),
      pairedAt: null
    };
    await savePairingFile(next, sha, `Minta pairing bot WA untuk ${phone}`);

    await notifyTelegram(req, { action: 'Permintaan Pairing Bot WA', detail: { Nomor: phone } });

    return res.status(200).json({ success: true });
  } catch (e) {
    await notifyError(req, { action: 'Permintaan Pairing Bot WA', error: e, extra: { Nomor: phone } });
    return res.status(500).json({ success: false, error: e.message });
  }
}
