// Vercel Middleware — Cek maintenance mode di server-side.
// Saat maintenance aktif, SEMUA halaman (kecuali /api/* dan /maintenance.html)
// di-redirect ke /maintenance.html
//
// Env var yang dibutuhkan (sama seperti bot.js):
//   GITHUB_PAT, GITHUB_WARNING_PATH (atau GITHUB_TOKENS_PATH untuk fallback)
//
// File ini HARUS ada di root project (bukan di api/).
// Vercel otomatis eksekusi middleware.ts/js untuk setiap request.

import { NextResponse } from '@vercel/next/server';

// Cache maintenance status biar ga hit GitHub API tiap request
let maintCache = { status: false, message: '', expiry: 0 };

async function checkMaintenance() {
  const now = Date.now();
  if (now < maintCache.expiry) {
    return { status: maintCache.status, message: maintCache.message };
  }

  try {
    // Parse path dari env var (sama kayak di github.js)
    const warningPath = process.env.GITHUB_WARNING_PATH || (() => {
      const tokensPath = process.env.GITHUB_TOKENS_PATH;
      if (!tokensPath) return null;
      const parts = tokensPath.split('/');
      const [owner, repo, branch] = parts;
      return `${owner}/${repo}/${branch}/warning.json`;
    })();

    if (!warningPath) return { status: false, message: '' };

    const parts = warningPath.split('/');
    const [owner, repo, branch, ...pathParts] = parts;
    const filePath = pathParts.join('/');
    const pat = process.env.GITHUB_PAT;

    if (!pat) return { status: false, message: '' };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'cyronime-middleware'
      }
    });

    if (!res.ok) return { status: false, message: '' };

    const data = await res.json();
    const decoded = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));

    const status = !!decoded.maintenance;
    const message = decoded.maintenanceMessage || 'Website sedang dalam pemeliharaan.';

    // Cache 30 detik
    maintCache = { status, message, expiry: now + 30000 };

    return { status, message };
  } catch {
    return { status: false, message: '' };
  }
}

export default async function middleware(req) {
  const { pathname } = req.nextUrl;

  // Skip API routes, static assets, dan maintenance page sendiri
  if (pathname.startsWith('/api/')) return NextResponse.next();
  if (pathname === '/maintenance.html') return NextResponse.next();
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') return NextResponse.next();
  if (pathname.match(/\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2|ttf)$/)) return NextResponse.next();

  const { status, message } = await checkMaintenance();

  if (!status) return NextResponse.next();

  // Kalau akses / (index), biarkan index.html yang handle (biar tampil maintenance overlay)
  // Tapi kalau akses halaman lain, redirect ke maintenance.html
  if (pathname === '/') return NextResponse.next();

  // Redirect ke maintenance page dengan pesan
  const maintUrl = new URL('/maintenance.html', req.url);
  maintUrl.searchParams.set('msg', message);
  return NextResponse.redirect(maintUrl);
}

export const config = {
  // Match semua path kecuali /api/*
  matcher: ['/((?!api).*)']
};
