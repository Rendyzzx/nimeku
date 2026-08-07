// Vercel Edge Middleware — Cek maintenance mode di server-side.
// Saat maintenance aktif, SEMUA halaman (kecuali /api/* dan /maintenance.html)
// di-redirect ke /maintenance.html
//
// Env var yang dibutuhkan (sama seperti bot.js):
//   GITHUB_PAT, GITHUB_WARNING_PATH (atau GITHUB_TOKENS_PATH untuk fallback)
//
// File ini HARUS ada di root project (bukan di api/).
// Native Vercel Edge Middleware — TIDAK butuh package next/server.

export const config = {
  matcher: ['/((?!api|_next|favicon).*)']
};

// Cache maintenance status biar ga hit GitHub API tiap request
let maintCache = { status: false, message: '', expiry: 0 };

async function checkMaintenance() {
  const now = Date.now();
  if (now < maintCache.expiry) {
    return { status: maintCache.status, message: maintCache.message };
  }

  try {
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
    // Edge runtime punya atob() global, tidak ada Buffer
    const decoded = JSON.parse(
      decodeURIComponent(
        atob(data.content.replace(/\n/g, ''))
          .split('')
          .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
      )
    );

    const status = !!decoded.maintenance;
    const message = decoded.maintenanceMessage || 'Website sedang dalam pemeliharaan.';

    maintCache = { status, message, expiry: now + 30000 };

    return { status, message };
  } catch {
    return { status: false, message: '' };
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/maintenance.html') {
    return fetch(request);
  }
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') {
    return fetch(request);
  }
  if (pathname.match(/\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2|ttf)$/)) {
    return fetch(request);
  }

  const { status, message } = await checkMaintenance();

  if (!status) return fetch(request);

  // Biarkan index.html sendiri yang tampilkan overlay maintenance (client-side)
  if (pathname === '/') return fetch(request);

  // Redirect halaman lain ke maintenance.html
  const maintUrl = new URL('/maintenance.html', request.url);
  maintUrl.searchParams.set('msg', message);
  return Response.redirect(maintUrl, 302);
}
