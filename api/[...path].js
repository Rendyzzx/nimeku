// api/[...path].js
//
// Backend proxy untuk CyroMedia (Vercel Serverless Function).
//
// Fungsi file ini:
// 1. Frontend TIDAK lagi memanggil API pihak ketiga secara langsung dari browser.
//    Semua request dari frontend pergi ke domain sendiri: /api/<endpoint>
//    lalu file ini yang meneruskan ke API asli dari sisi server.
// 2. Alamat API asli WAJIB disimpan sebagai environment variable di Vercel
//    (COMIC_API_BASE) — tidak ada nilai default di kode ini, jadi URL API
//    asli tidak pernah tertulis di source code / repo git kamu.
// 3. Menambahkan cache di edge/CDN Vercel (Cache-Control) supaya lebih
//    cepat dan mengurangi beban ke API asli.
//
// PENTING soal keamanan (biar ekspektasinya pas):
// - Ini BUKAN membuat API jadi "tidak bisa dibobol sama sekali". Siapa pun
//   masih bisa membuka tab Network di browser dan melihat response dari
//   domain kamu sendiri (yaitu /api/...), karena itu memang request yang
//   dikirim browser mereka ke server kamu.
// - Manfaat nyata dari proxy ini: (a) URL & struktur API pihak ketiga yang
//   asli tidak lagi terlihat langsung di source code frontend, (b) orang
//   lain tidak bisa asal comot dan pakai API pihak ketiga itu langsung
//   mengatasnamakan situs kamu / melewati batasanmu, (c) kamu bisa
//   menambahkan cache, rate-limit, dan validasi asal request (lihat
//   ALLOWED_ORIGIN di bawah) yang tidak mungkin dilakukan kalau API asli
//   dipanggil langsung dari browser.

export default async function handler(req, res) {
  // --- (Opsional tapi disarankan) batasi siapa yang boleh pakai proxy ini ---
  // Isi ALLOWED_ORIGIN di Vercel Environment Variables dengan domain kamu,
  // misalnya: https://cyromedia.vercel.app
  // Kalau tidak diisi, pengecekan ini dilewati (semua origin boleh).
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.origin || '';
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    res.status(403).json({ success: false, message: 'Origin tidak diizinkan.' });
    return;
  }

  // Alamat API asli WAJIB diisi lewat Vercel > Settings > Environment Variables
  // dengan nama COMIC_API_BASE. Sengaja TIDAK ada nilai default/hardcode di sini,
  // supaya URL API asli tidak pernah tertulis di source code / repo git kamu.
  const rawBase = process.env.COMIC_API_BASE;
  if (!rawBase) {
    res.status(500).json({
      success: false,
      message: 'Server belum dikonfigurasi: env var COMIC_API_BASE belum di-set di Vercel.',
    });
    return;
  }
  const upstreamBase = rawBase.replace(/\/$/, '');

  // req.query.path adalah array segmen path dari [...path].js
  // contoh: /api/detail/some-slug  ->  path = ['detail', 'some-slug']
  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const subPath = segments.map(encodeURIComponent).join('/');

  // Teruskan query string lain (selain "path" bawaan Vercel) ke API asli
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
      // API asli tidak balas JSON (mis. halaman error HTML) -> bungkus rapi
      res.status(502).json({ success: false, message: 'Respons API tidak valid.' });
      return;
    }

    // Cache di CDN Vercel selama 2 menit, boleh sajikan versi lama sampai 5 menit
    // sambil ambil yang baru di belakang layar (mengurangi beban & mempercepat load).
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
