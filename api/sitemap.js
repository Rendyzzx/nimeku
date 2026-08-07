// Endpoint sitemap.xml — auto-generate dari services.json + file HTML di repo.
// Tidak perlu env var tambahan. Domain di-detect dari request header.
//
// Akses di: https://domain-kamu.vercel.app/api/sitemap
// Atau set rewrite di vercel.json kalau mau /sitemap.xml

import { getServicesFile, listProjectFiles } from './_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Detect domain dari request
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'cyronime.my.id';
  const baseUrl = `${protocol}://${host}`;

  try {
    // Ambil daftar services dari services.json
    const { services } = await getServicesFile();

    // Ambil daftar file HTML di root repo
    let htmlFiles = [];
    try {
      const rootFiles = await listProjectFiles('');
      htmlFiles = rootFiles.filter(f => f.name.endsWith('.html')).map(f => f.name);
    } catch {
      // Kalau gagal list, tetap jalan dengan services saja
    }

    // Build URL list
    const today = new Date().toISOString().split('T')[0];
    const urls = [];

    // Halaman utama (index)
    urls.push({
      loc: `${baseUrl}/`,
      lastmod: today,
      changefreq: 'daily',
      priority: '1.0'
    });

    // Semua services
    services.forEach(svc => {
      if (svc.locked) return; // skip layanan yang dikunci
      const page = svc.page || '';
      if (!page) return;

      // Internal page (mulai dengan /)
      if (page.startsWith('/')) {
        urls.push({
          loc: `${baseUrl}${page}`,
          lastmod: today,
          changefreq: 'weekly',
          priority: '0.8'
        });
      }
      // External page (http/https) — skip, bukan domain kita
    });

    // File HTML di root yang belum ada di services (sebagai backup)
    htmlFiles.forEach(file => {
      const url = `${baseUrl}/${file}`;
      if (!urls.some(u => u.loc === url) && file !== 'index.html') {
        urls.push({
          loc: url,
          lastmod: today,
          changefreq: 'weekly',
          priority: '0.6'
        });
      }
    });

    // Generate XML
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(u => [
        '  <url>',
        `    <loc>${escapeXml(u.loc)}</loc>`,
        `    <lastmod>${u.lastmod}</lastmod>`,
        `    <changefreq>${u.changefreq}</changefreq>`,
        `    <priority>${u.priority}</priority>`,
        '  </url>'
      ].join('\n')),
      '</urlset>'
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).send(xml);
  } catch (e) {
    // Fallback: sitemap minimal cuma halaman utama
    const today = new Date().toISOString().split('T')[0];
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      `    <loc>${escapeXml(baseUrl)}/</loc>`,
      `    <lastmod>${today}</lastmod>`,
      '    <changefreq>daily</changefreq>',
      '    <priority>1.0</priority>',
      '  </url>',
      '</urlset>'
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(xml);
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
