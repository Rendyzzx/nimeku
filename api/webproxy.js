// api/webproxy.js
//
// Generic web proxy (bukan spesifik anime/manga) — fetch sembarang URL dari
// server, opsional ganti header User-Agent, lalu kirim balik ke browser.
// File nyata di folder api/ ini otomatis kebal dari rewrite /api/anime dan
// /api/manga yang sudah ada di vercel.json, jadi TIDAK PERLU ubah vercel.json
// sama sekali (persis alasan yang sama seperti api/manga/[...path].js).
//
// Dipakai oleh: /webproxy.html
//
// Contoh: /api/webproxy?url=https://www.google.com&ua=<url-encoded UA>

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const targetUrl = req.query.url;
  const customUA = req.query.ua;

  if (!targetUrl) {
    res.status(400).send('Parameter "url" wajib diisi. Contoh: /api/webproxy?url=https://example.com');
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res.status(400).send('URL tidak valid.');
    return;
  }

  const DEFAULT_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const upstream = await fetch(parsedTarget.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': customUA || DEFAULT_UA,
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const contentType = upstream.headers.get('content-type') || 'text/plain';
    res.setHeader('Content-Type', contentType);
    // Header ini sengaja dibuang supaya halaman target bisa dirender di
    // dalam <iframe> di webproxy.html (banyak situs set ini untuk mencegah
    // di-embed di domain lain / "clickjacking protection").
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    if (contentType.includes('text/html')) {
      let html = await upstream.text();
      html = rewriteLinks(html, parsedTarget);
      res.status(upstream.status).send(html);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    res.status(timedOut ? 504 : 502).send(
      timedOut ? 'Waktu permintaan ke situs target habis.' : 'Gagal mengambil halaman target: ' + err.message
    );
  } finally {
    clearTimeout(timeout);
  }
}

// Rewrite href/src/action supaya navigasi lanjutan tetap lewat /api/webproxy,
// bukan langsung ke domain aslinya (yang akan kena CORS/X-Frame-Options lagi).
function rewriteLinks(html, baseUrl) {
  return html.replace(/(href|src|action)=(["'])([^"']*)\2/g, (match, attr, quote, link) => {
    if (!link || link.startsWith('data:') || link.startsWith('javascript:') || link.startsWith('#')) {
      return match;
    }
    try {
      const absolute = new URL(link, baseUrl).href;
      return `${attr}=${quote}/api/webproxy?url=${encodeURIComponent(absolute)}${quote}`;
    } catch {
      return match;
    }
  });
}
