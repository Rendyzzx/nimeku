// Helper baca & tulis file JSON di repo GitHub (Contents API).
// Dipakai untuk tokens.json (kelola token seller), warning.json (konfigurasi
// umum website), dan freemium.json (tracking request gratis per IP).
//
// Env var yang dibutuhkan:
//   GITHUB_TOKENS_PATH   = username/repo/branch/path/ke/tokens.json
//   GITHUB_WARNING_PATH  = username/repo/branch/path/ke/warning.json
//                          (opsional — kalau kosong, otomatis pakai repo/branch
//                           yang sama dengan GITHUB_TOKENS_PATH + nama file warning.json)
//   GITHUB_FREEMIUM_PATH = username/repo/branch/path/ke/freemium.json
//                          (opsional — kalau kosong, otomatis pakai repo/branch
//                           yang sama dengan GITHUB_TOKENS_PATH + nama file freemium.json)
//   GITHUB_PAT           = Personal Access Token dengan scope "repo" (READ + WRITE)

function parsePath(envValue, envName) {
  if (!envValue) throw new Error(`${envName} belum diset di Environment Variables.`);
  const parts = envValue.split('/');
  const [owner, repo, branch, ...pathParts] = parts;
  const filePath = pathParts.join('/');
  if (!owner || !repo || !branch || !filePath) {
    throw new Error(`Format ${envName} salah. Contoh: username/repo/branch/nama-file.json`);
  }
  return { owner, repo, branch, filePath };
}

function parseTokensPath() {
  return parsePath(process.env.GITHUB_TOKENS_PATH, 'GITHUB_TOKENS_PATH');
}

function parseWarningPath() {
  if (process.env.GITHUB_WARNING_PATH) {
    return parsePath(process.env.GITHUB_WARNING_PATH, 'GITHUB_WARNING_PATH');
  }
  // Fallback: pakai owner/repo/branch yang sama dengan tokens, file warning.json.
  const { owner, repo, branch } = parseTokensPath();
  return { owner, repo, branch, filePath: 'warning.json' };
}

function parseFreemiumPath() {
  if (process.env.GITHUB_FREEMIUM_PATH) {
    return parsePath(process.env.GITHUB_FREEMIUM_PATH, 'GITHUB_FREEMIUM_PATH');
  }
  // Fallback: pakai owner/repo/branch yang sama dengan tokens, file freemium.json.
  const { owner, repo, branch } = parseTokensPath();
  return { owner, repo, branch, filePath: 'freemium.json' };
}

function ghHeaders() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error('GITHUB_PAT belum diset di Environment Variables.');
  return {
    accept: 'application/vnd.github.v3+json',
    'user-agent': 'seller-auth-proxy',
    authorization: `token ${pat}`
  };
}

// Ambil isi file JSON mentah + sha dari GitHub. Kalau file belum ada,
// balikin defaultValue dengan sha = null.
async function getJsonFile({ owner, repo, branch, filePath }, defaultValue) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
  const r = await fetch(apiUrl, { headers: ghHeaders() });

  if (r.status === 404) {
    return { data: defaultValue, sha: null };
  }
  if (!r.ok) throw new Error(`Gagal ambil ${filePath} dari GitHub.`);

  const resp = await r.json();
  const text = Buffer.from(resp.content, 'base64').toString('utf-8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = defaultValue;
  }
  return { data: parsed, sha: resp.sha };
}

// Simpan balik file JSON ke GitHub (commit baru).
async function saveJsonFile({ owner, repo, branch, filePath }, jsonObj, sha, commitMessage) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  const content = Buffer.from(
    JSON.stringify(jsonObj, null, 2),
    'utf-8'
  ).toString('base64');

  const body = {
    message: commitMessage || `Update ${filePath}`,
    content,
    branch
  };
  if (sha) body.sha = sha;

  const r = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Gagal simpan ${filePath} ke GitHub: ${errBody}`);
  }
  const data = await r.json();
  return data.content.sha;
}

// Deep-merge dangkal khusus buat objek config: field yang ada di `data`
// menimpa default, tapi field baru yang belum pernah disimpan tetap ada
// (biar nambah fitur baru gak bikin config lama korup).
function deepMerge(defaults, data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data === undefined ? defaults : data;
  }
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (data[key] === undefined) continue;
    if (
      typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key]) &&
      typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])
    ) {
      out[key] = deepMerge(defaults[key], data[key]);
    } else {
      out[key] = data[key];
    }
  }
  // Simpan juga field ekstra yang mungkin sudah ada di data tapi belum ada di defaults
  for (const key of Object.keys(data)) {
    if (!(key in out)) out[key] = data[key];
  }
  return out;
}

// ---- Wrapper khusus tokens.json ----

function normalizeLegacyTokens(arr) {
  return arr.map(t => (typeof t === 'string' ? { token: t, limit: -1, used: 0 } : t));
}

async function getTokensFile() {
  const loc = parseTokensPath();
  const { data, sha } = await getJsonFile(loc, { tokens: [] });
  const tokens = Array.isArray(data) ? normalizeLegacyTokens(data) : (data.tokens || []);
  return { tokens, sha };
}

async function saveTokensFile(tokens, sha, commitMessage) {
  const loc = parseTokensPath();
  return saveJsonFile(loc, { tokens }, sha, commitMessage);
}

// ---- Wrapper khusus warning.json (config umum website) ----
// Ini satu file JSON tunggal yang menyimpan SEMUA yang bisa diatur lewat bot:
// banner, maintenance, admin tambahan, dan seluruh tampilan/konten website
// (branding, warna, kontak, promo, FAQ, mode aktivasi, dll).

const DEFAULT_WARNING = {
  // Banner peringatan/pengumuman
  active: false,
  type: 'info',
  message: '',
  updatedAt: null,

  // Mode maintenance
  maintenance: false,
  maintenanceMessage: '',

  // Admin tambahan bot (di luar TELEGRAM_ADMIN_IDS di env)
  admins: [],

  // Konfigurasi tampilan & konten website, dikontrol via bot Telegram
  site: {
    brandName: 'Cyronime',
    brandBadge: 'PRO',
    tagline: 'Layanan Aktivasi Premium',
    footerText: 'Copyright by <strong>Akirax</strong>',
    pageTitle: 'Cyronime — Portal Layanan Premium',
    faviconUrl: '',
    logoUrl: '',
    logoLetter: '',
    heroImage: '',

    // Tema warna (CSS variables — lihat index.html)
    primaryColor: '#D6A755',
    accentColor: '#5C8AA6',
    bgColor: '#0B0C10',

    // Kontak
    waNumber: '6281249578370',
    waMessage: 'Halo Akira, saya butuh bantuan Alight Motion Premium',
    social: {},

    // Promo banner (beda dari banner peringatan — untuk promosi/diskon)
    promo: { active: false, text: '' },

    // Konten tambahan (opsional, disembunyikan kalau kosong)
    faq: '',
    testimoni: '',
    stock: '',

    // Pengumuman popup sekali muncul
    announcement: { active: false, text: '' },

    // Mode aktivasi (tab): enable/disable, label custom, badge custom
    modes: {
      pribadi: { enabled: true, label: '', badge: '' },
      generate: { enabled: true, label: '', badge: '' },
      buyer: { enabled: true, label: '', badge: '' }
    }
  }
};

async function getWarningFile() {
  const loc = parseWarningPath();
  const { data, sha } = await getJsonFile(loc, DEFAULT_WARNING);
  return { warning: deepMerge(DEFAULT_WARNING, data), sha };
}

async function saveWarningFile(warning, sha, commitMessage) {
  const loc = parseWarningPath();
  return saveJsonFile(loc, warning, sha, commitMessage);
}

// ---- Wrapper khusus freemium.json (tracking request gratis per IP) ----
// Format freemium.json:
//   { "visitors": { "1.2.3.4": { "count": 3, "date": "2026-08-07" } } }
// count di-reset tiap hari (tanggal UTC). Limit default 10 request gratis.

const DEFAULT_FREEMIUM = { visitors: {} };

async function getFreemiumFile() {
  const loc = parseFreemiumPath();
  const { data, sha } = await getJsonFile(loc, DEFAULT_FREEMIUM);
  return { visitors: data.visitors || {}, sha };
}

async function saveFreemiumFile(visitors, sha, commitMessage) {
  const loc = parseFreemiumPath();
  return saveJsonFile(loc, { visitors }, sha, commitMessage);
}


// ---- Wrapper khusus services.json (daftar layanan untuk portal superapp) ----
// Format services.json:
//   { "services": [ { "id": "alightmotion", "name": "Alight Motion", "description": "...",
//      "icon": "fa-bolt", "color": "#D6A755", "page": "/alightmotion.html",
//      "locked": false, "lockMessage": "", "order": 0 } ] }

const DEFAULT_SERVICES = {
  services: [
    {
      id: 'alightmotion',
      name: 'Alight Motion Premium',
      description: 'Layanan aktivasi premium Alight Motion',
      icon: 'fa-bolt',
      color: '#D6A755',
      page: '/alightmotion.html',
      locked: false,
      lockMessage: '',
      order: 0
    }
  ]
};

function parseServicesPath() {
  if (process.env.GITHUB_SERVICES_PATH) {
    return parsePath(process.env.GITHUB_SERVICES_PATH, 'GITHUB_SERVICES_PATH');
  }
  // Fallback: pakai owner/repo/branch yang sama dengan tokens, file services.json
  const { owner, repo, branch } = parseTokensPath();
  return { owner, repo, branch, filePath: 'services.json' };
}

async function getServicesFile() {
  const loc = parseServicesPath();
  const { data, sha } = await getJsonFile(loc, DEFAULT_SERVICES);
  return { services: data.services || [], sha };
}

async function saveServicesFile(services, sha, commitMessage) {
  const loc = parseServicesPath();
  return saveJsonFile(loc, { services }, sha, commitMessage);
}


// ---- Generic file operations (untuk api/*.js dan *.html) ----
// File kode (API + HTML) bisa di repo yang BERBEDA dengan file data
// (tokens.json, services.json, dll).
// Set GITHUB_PROJECT_PATH = username/repo/branch kalau repo kode beda
// dengan repo data. Kalau kosong, otomatis pakai repo/branch yang sama
// dengan GITHUB_TOKENS_PATH.

function parseProjectPath() {
  if (process.env.GITHUB_PROJECT_PATH) {
    const parts = process.env.GITHUB_PROJECT_PATH.split('/');
    const [owner, repo, branch] = parts;
    if (!owner || !repo || !branch) {
      throw new Error('Format GITHUB_PROJECT_PATH salah. Contoh: Rendyzzx/Amo/main');
    }
    return { owner, repo, branch };
  }
  // Fallback: pakai owner/repo/branch yang sama dengan tokens
  const { owner, repo, branch } = parseTokensPath();
  return { owner, repo, branch };
}

async function getProjectFile(filePath) {
  const { owner, repo, branch } = parseProjectPath();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
  const r = await fetch(apiUrl, { headers: ghHeaders() });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error(`Gagal ambil ${filePath} dari GitHub.`);
  const resp = await r.json();
  const text = Buffer.from(resp.content, 'base64').toString('utf-8');
  return { content: text, sha: resp.sha };
}

async function saveProjectFile(filePath, textContent, sha, commitMessage) {
  const { owner, repo, branch } = parseProjectPath();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const content = Buffer.from(textContent, 'utf-8').toString('base64');
  const body = {
    message: commitMessage || `Update ${filePath}`,
    content,
    branch
  };
  if (sha) body.sha = sha;
  const r = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Gagal simpan ${filePath} ke GitHub: ${errBody}`);
  }
  const data = await r.json();
  return data.content.sha;
}

async function deleteProjectFile(filePath, sha, commitMessage) {
  const { owner, repo, branch } = parseProjectPath();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const body = {
    message: commitMessage || `Hapus ${filePath}`,
    sha,
    branch
  };
  const r = await fetch(apiUrl, {
    method: 'DELETE',
    headers: { ...ghHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Gagal hapus ${filePath} dari GitHub: ${errBody}`);
  }
  return true;
}

async function listProjectFiles(dirPath) {
  const { owner, repo, branch } = parseProjectPath();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  const r = await fetch(apiUrl, { headers: ghHeaders() });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`Gagal list ${dirPath} dari GitHub.`);
  const resp = await r.json();
  if (!Array.isArray(resp)) return [];
  return resp.map(item => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
}

async function saveProjectBinaryFile(filePath, base64Content, sha, commitMessage) {
  const { owner, repo, branch } = parseProjectPath();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const body = {
    message: commitMessage || `Upload ${filePath}`,
    content: base64Content,
    branch
  };
  if (sha) body.sha = sha;
  const r = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Gagal upload ${filePath} ke GitHub: ${errBody}`);
  }
  const data = await r.json();
  return data.content.sha;
}

function buildRawGithubUrl(filePath) {
  const { owner, repo, branch } = parseProjectPath();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

// Alias semantik — dipakai di command-command "kelola tampilan website"
// supaya kodenya lebih jelas dibaca (secara teknis file & isinya sama).
const getSiteConfig = getWarningFile;
const saveSiteConfig = saveWarningFile;

export {
  getTokensFile,
  saveTokensFile,
  getWarningFile,
  saveWarningFile,
  getSiteConfig,
  saveSiteConfig,
  DEFAULT_WARNING,
  getFreemiumFile,
  saveFreemiumFile,
  getServicesFile,
  saveServicesFile,
  getProjectFile,
  saveProjectFile,
  deleteProjectFile,
  listProjectFiles,
  saveProjectBinaryFile,
  buildRawGithubUrl
};
