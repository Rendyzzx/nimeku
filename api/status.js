// Endpoint publik (dipanggil dari frontend index.html) untuk ambil status
// banner peringatan/pengumuman, status maintenance, dan seluruh konfigurasi
// tampilan/konten website (branding, warna, kontak, promo, mode aktivasi, dll)
// yang diatur lewat bot Telegram (api/bot.js).

import { getWarningFile } from './_lib/github.js';
import { notifyError } from './_lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { warning } = await getWarningFile();
    // Cache singkat di edge/CDN biar gak nembak GitHub API tiap request visitor.
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({
      success: true,
      warning,
      maintenance: !!(warning && warning.maintenance),
      maintenanceMessage: (warning && warning.maintenanceMessage) || 'Website sedang dalam pemeliharaan (maintenance).',
      site: (warning && warning.site) || null
    });
  } catch (e) {
    await notifyError(req, { action: 'Ambil Status Banner Website', error: e });
    // Kalau gagal ambil, anggap saja tidak ada warning/maintenance aktif (jangan bikin web down).
    return res.status(200).json({
      success: true,
      warning: { active: false },
      maintenance: false,
      maintenanceMessage: '',
      site: null
    });
  }
}
