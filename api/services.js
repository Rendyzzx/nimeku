// Endpoint publik untuk ambil daftar layanan (services) yang tampil di portal.
// Dipanggil dari frontend index.html (portal page).
//
// Format services.json:
//   { "services": [ { "id": "alightmotion", "name": "Alight Motion Premium",
//     "description": "...", "icon": "fa-bolt", "color": "#FFD028",
//     "page": "/alightmotion.html", "locked": false, "lockMessage": "", "order": 0 } ] }
//
// Tidak perlu env var tambahan — otomatis pakai repo yang sama dengan tokens.json
// (file services.json). Kalau mau terpisah, set GITHUB_SERVICES_PATH.

import { getServicesFile } from './_lib/github.js';
import { notifyError } from './_lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Cache singkat di edge biar gak nembak GitHub API tiap request
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

  try {
    const { services } = await getServicesFile();

    // Sort by order (ascending), fallback by index
    const sorted = [...services].sort((a, b) => {
      const oa = a.order ?? 999;
      const ob = b.order ?? 999;
      return oa - ob;
    });

    return res.status(200).json({
      success: true,
      services: sorted
    });
  } catch (e) {
    await notifyError(req, { action: 'Ambil daftar layanan', error: e });

    // Kalau gagal, return default (Alight Motion saja)
    return res.status(200).json({
      success: true,
      services: [
        {
          id: 'alightmotion',
          name: 'Alight Motion Premium',
          description: 'Layanan aktivasi premium Alight Motion',
          icon: 'fa-bolt',
          color: '#FFD028',
          page: '/alightmotion.html',
          locked: false,
          lockMessage: '',
          order: 0
        }
      ],
      fallback: true
    });
  }
}
