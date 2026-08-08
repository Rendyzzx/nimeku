// api/manga/[...path].js
//
// Backend proxy komik untuk situs ini (Vercel Serverless Function, catch-all).
//
// PENTING soal nama file: nama "[...path].js" HARUS persis seperti ini
// (termasuk tanda kurung siku dan tiga titik). Ini konvensi Vercel untuk
// "catch-all dynamic route" — satu file ini menangani SEMUA path di bawah
// /api/manga/, misalnya:
//   /api/manga/list          -> req.query.path = ['list']
//   /api/manga/detail/naruto -> req.query.path = ['detail', 'naruto']
//
// Kenapa ditaruh di /api/manga/... (bukan langsung /api/...)?
// Karena vercel.json project ini sudah punya rewrite umum:
//   "/api/:path*" -> "https://www.sankavollerei.com/anime/:path*"
// Rewrite itu dipakai fitur anime (nonton.html) dan akan "menelan" semua
// /api/* yang tidak punya function sendiri. Karena function (file nyata di
// folder api/) selalu diprioritaskan Vercel di atas rewrite, menaruh proxy
// komik di /api/manga/[...path].js membuatnya kebal dari rewrite anime itu,
// tanpa perlu mengubah vercel.json sama sekali.
//
// Alamat API asli WAJIB diisi lewat Vercel > Settings > Environment Variables
// dengan nama COMIC_API_BASE, contoh: https://www.sankavollerei.web.id
// Sengaja tidak ada nilai default/hardcode di sini.

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.origin || '';
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    res.status(403).json({ success: false, message: 'Origin tidak diizinkan.' });
    return;
  }

  const rawBase = process.env.COMIC_API_BASE;
  if (!rawBase) {
    res.status(500).json({
      success: false,
      message: 'Server belum dikonfigurasi: env var COMIC_API_BASE belum di-set di Vercel.',
    });
    return;
  }
  const upstreamBase = rawBase.replace(/\/$/, '');

  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const subPath = segments.map(encodeURIComponent).join('/');

  const extraParams = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) value.forEach(v => extraParams.append(key, v));
    else extraParams.append(key, value);
  }
  const qs = extraParams.toString();

  const upstreamUrl = `${upstreamBase}/comic/bacakomik/${subPath}${qs ? '?' + qs : ''}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    const contentType = upstreamRes.headers.get('content-type') || '';
    const bodyText = await upstreamRes.text();

    if (!contentType.includes('application/json')) {
      res.status(502).json({ success: false, message: 'Respons API tidak valid.' });
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(upstreamRes.status).send(bodyText);
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    res.status(504).json({
      success: false,
      message: timedOut ? 'Waktu permintaan ke server komik habis.' : 'Gagal menghubungi server komik.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
