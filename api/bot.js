// Webhook bot Telegram untuk kelola token seller (buat, hapus, atur limit),
// kirim peringatan/pengumuman (banner), atur mode maintenance website,
// kustomisasi profil bot Telegram (nama, deskripsi, foto profil),
// DAN 30 fitur pengaturan tampilan/konten website (branding, warna, kontak,
// promo, mode aktivasi, admin tambahan, backup/restore, dll).
//
// ==== SETUP ====
// 1. Buat bot lewat @BotFather, catat TELEGRAM_BOT_TOKEN.
// 2. Chat bot itu sekali, cari chat ID kamu lewat @userinfobot -> itu ADMIN ID.
// 3. Set Environment Variables di Vercel:
//      TELEGRAM_BOT_TOKEN  = token bot
//      TELEGRAM_ADMIN_IDS  = chat id kamu (boleh lebih dari satu, pisah koma)
//      GITHUB_TOKENS_PATH  = username/repo/branch/tokens.json
//      GITHUB_WARNING_PATH = username/repo/branch/warning.json   (opsional)
//      GITHUB_PAT          = PAT dengan scope repo (READ + WRITE)
// 4. Daftarkan webhook (buka sekali di browser):
//      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://DOMAIN-KAMU.vercel.app/api/bot
//
// ==== PERINTAH DI TELEGRAM ====
// Ketik /help di chat bot buat lihat daftar lengkap & selalu up to date.

import {
  getTokensFile,
  saveTokensFile,
  getWarningFile,
  saveWarningFile,
  getSiteConfig,
  saveSiteConfig,
  DEFAULT_WARNING,
  getServicesFile,
  saveServicesFile,
  getProjectFile,
  saveProjectFile,
  deleteProjectFile,
  listProjectFiles,
  saveProjectBinaryFile,
  buildRawGithubUrl
} from './_lib/github.js';

// Banner gambar buat mempercantik bot. Bisa diganti ke URL gambar sendiri
// (logo/banner brand kamu) kapan aja, tinggal ubah BANNER_IMAGE_URL.
const BANNER_IMAGE_URL =
  'https://placehold.co/900x420/0f0f1a/f5c518/png?text=Alight+Motion+Premium%0AControl+Panel&font=montserrat';

const VALID_MODES = ['pribadi', 'generate', 'buyer'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(200).json({ ok: true });

  const update = req.body || {};
  const message = update.message;
  if (!message) return res.status(200).json({ ok: true });

  const text = (message.text || message.caption || '').trim();
  const hasDocument = !!message.document;
  if (!text && !hasDocument) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;

  if (!(await isAdmin(chatId))) {
    await sendMessage(botToken, chatId, `⛔ <b>Akses ditolak</b>\nKamu tidak punya izin untuk mengakses bot ini.`);
    return res.status(200).json({ ok: true });
  }

  const cmd = (text.split(/\s+/)[0] || '').toLowerCase();

  try {
    // /start dan /help dikirim dengan gambar banner, tapi ada fallback teks.
    if (cmd === '/start' || cmd === '/help') {
      const helpMsg = helpText();
      try {
        await sendPhoto(botToken, chatId, BANNER_IMAGE_URL, helpMsg);
      } catch {
        await sendMessage(botToken, chatId, helpMsg);
      }
      return res.status(200).json({ ok: true });
    }

    // /restore bisa dikirim sebagai caption pada file .json — tangani sebelum
    // parsing teks biasa karena butuh akses ke message.document.
    if (cmd === '/restore') {
      const reply = await handleRestore(message, botToken);
      await sendMessage(botToken, chatId, reply);
      return res.status(200).json({ ok: true });
    }

    // /uploadfile bisa dikirim sebagai caption pada file dokumen — tangani sebelum
    // parsing teks biasa karena butuh akses ke message.document.
    if (cmd === '/uploadfile' || cmd === '/upload') {
      const reply = await handleUploadFile(message, botToken);
      await sendMessage(botToken, chatId, reply);
      return res.status(200).json({ ok: true });
    }

    const reply = await handleCommand(text, message, botToken);
    await sendMessage(botToken, chatId, reply);
  } catch (e) {
    await sendMessage(botToken, chatId, `❌ <b>Terjadi kesalahan</b>\n<code>${escapeHtml(e.message)}</code>`);
  }

  return res.status(200).json({ ok: true });
}

async function isAdmin(chatId) {
  const raw = process.env.TELEGRAM_ADMIN_IDS || '';
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.includes(String(chatId))) return true;

  // Bukan admin utama (env) — cek juga admin tambahan yang disimpan via /addadmin.
  try {
    const { warning } = await getWarningFile();
    return Array.isArray(warning.admins) && warning.admins.map(String).includes(String(chatId));
  } catch {
    return false;
  }
}

async function handleCommand(text, message, botToken) {
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const restArgs = text.slice(cmdRaw.length).trim(); // teks lengkap setelah command (untuk pesan panjang)

  switch (cmd) {
    // ================= KELOLA TOKEN SELLER =================
    case '/addtoken': {
      const [token, limitRaw] = args;
      if (!token) return '📝 Format:\n<code>/addtoken TOKEN LIMIT</code>\n\nContoh: <code>/addtoken SELLER01 50</code>';
      const limit = parseLimit(limitRaw);

      const { tokens, sha } = await getTokensFile();
      if (tokens.some(t => t.token === token)) {
        return `⚠️ Token <code>${token}</code> sudah ada.\nPakai /setlimit kalau mau ubah limitnya.`;
      }
      tokens.push({ token, limit, used: 0 });
      await saveTokensFile(tokens, sha, `Tambah token ${token}`);
      return (
        `✅ <b>Token Berhasil Dibuat</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `🔑 Token   : <code>${token}</code>\n` +
        `📊 Limit   : ${formatLimit(limit)}\n` +
        `━━━━━━━━━━━━━━`
      );
    }

    case '/setlimit': {
      const [token, limitRaw] = args;
      if (!token || limitRaw === undefined) return '📝 Format:\n<code>/setlimit TOKEN LIMIT</code>';
      const limit = parseLimit(limitRaw);

      const { tokens, sha } = await getTokensFile();
      const entry = tokens.find(t => t.token === token);
      if (!entry) return `⚠️ Token <code>${token}</code> tidak ditemukan.`;
      entry.limit = limit;
      await saveTokensFile(tokens, sha, `Ubah limit token ${token}`);
      return `✅ Limit token <code>${token}</code> diubah jadi <b>${formatLimit(limit)}</b>.`;
    }

    case '/reset': {
      const [token] = args;
      if (!token) return '📝 Format:\n<code>/reset TOKEN</code>';

      const { tokens, sha } = await getTokensFile();
      const entry = tokens.find(t => t.token === token);
      if (!entry) return `⚠️ Token <code>${token}</code> tidak ditemukan.`;
      entry.used = 0;
      await saveTokensFile(tokens, sha, `Reset pemakaian token ${token}`);
      return `🔄 Pemakaian token <code>${token}</code> direset ke <b>0</b>.`;
    }

    case '/deltoken': {
      const [token] = args;
      if (!token) return '📝 Format:\n<code>/deltoken TOKEN</code>';

      const { tokens, sha } = await getTokensFile();
      const idx = tokens.findIndex(t => t.token === token);
      if (idx === -1) return `⚠️ Token <code>${token}</code> tidak ditemukan.`;
      tokens.splice(idx, 1);
      await saveTokensFile(tokens, sha, `Hapus token ${token}`);
      return `🗑️ Token <code>${token}</code> berhasil dihapus.`;
    }

    case '/listtoken': {
      const { tokens } = await getTokensFile();
      if (tokens.length === 0) return '📋 Belum ada token yang terdaftar.';
      const lines = tokens.map(t => {
        const bar = usageBar(t.used || 0, t.limit ?? -1);
        return `🔑 <code>${t.token}</code>\n   ${bar}  ${t.used || 0}/${formatLimit(t.limit ?? -1)}`;
      });
      return `📋 <b>Daftar Token</b> (${tokens.length})\n━━━━━━━━━━━━━━\n${lines.join('\n\n')}`;
    }

    // ================= MAINTENANCE MODE =================
    case '/maintenance': {
      const customMsg = args.join(' ').trim();
      const { warning, sha } = await getWarningFile();

      const maintMsg = customMsg || warning.maintenanceMessage || 'Website sedang dalam pemeliharaan (maintenance). Silakan kembali lagi nanti.';
      warning.maintenance = true;
      warning.maintenanceMessage = maintMsg;
      warning.updatedAt = new Date().toISOString();

      await saveWarningFile(warning, sha, `Aktifkan maintenance mode: ${maintMsg}`);

      return (
        `🛠️ <b>Mode Maintenance DIAKTIFKAN</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `Pesan : ${escapeHtml(maintMsg)}\n` +
        `━━━━━━━━━━━━━━\n` +
        `Pengunjung website akan melihat layar maintenance.`
      );
    }

    case '/unmaintenance': {
      const { warning, sha } = await getWarningFile();
      warning.maintenance = false;
      warning.updatedAt = new Date().toISOString();

      await saveWarningFile(warning, sha, 'Matikan maintenance mode');

      return (
        `✅ <b>Mode Maintenance DIMATIKAN</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `Website telah kembali beroperasi dengan normal.`
      );
    }

    // ================= BANNER PERINGATAN =================
    case '/warn':
    case '/danger':
    case '/info': {
      const msg = args.join(' ').trim();
      if (!msg) return `📝 Format:\n<code>${cmd} pesan peringatan kamu</code>`;

      const type = cmd === '/warn' ? 'warning' : cmd === '/danger' ? 'danger' : 'info';
      const { warning, sha } = await getWarningFile();
      warning.active = true;
      warning.type = type;
      warning.message = msg;
      warning.updatedAt = new Date().toISOString();

      await saveWarningFile(warning, sha, `Set banner (${type}): ${msg}`);

      const label = type === 'warning' ? '⚠️ Warning' : type === 'danger' ? '🚨 Danger' : 'ℹ️ Info';
      return (
        `📢 <b>Banner Website Diaktifkan</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `Tipe    : ${label}\n` +
        `Pesan   : ${escapeHtml(msg)}\n` +
        `━━━━━━━━━━━━━━\n` +
        `Banner akan muncul di halaman website dalam beberapa detik.`
      );
    }

    case '/clearwarn': {
      const { warning, sha } = await getWarningFile();
      warning.active = false;
      warning.type = 'info';
      warning.message = '';
      warning.updatedAt = new Date().toISOString();

      await saveWarningFile(warning, sha, 'Clear banner website');
      return '✅ Banner di website sudah disembunyikan.';
    }

    case '/status': {
      const { warning } = await getWarningFile();

      const isMaint = !!warning.maintenance;
      const maintStatus = isMaint
        ? `🛠️ <b>AKTIF</b>\n   Pesan: ${escapeHtml(warning.maintenanceMessage || 'Sedang Maintenance')}`
        : '✅ Tidak aktif';

      const bannerStatus = warning.active
        ? `📢 <b>AKTIF</b> (${warning.type})\n   Pesan: ${escapeHtml(warning.message || '-')}`
        : '✅ Tidak ada banner aktif';

      const promo = warning.site && warning.site.promo;
      const promoStatus = promo && promo.active ? `🎉 <b>AKTIF</b>\n   Teks: ${escapeHtml(promo.text || '-')}` : '✅ Tidak aktif';

      const announcement = warning.site && warning.site.announcement;
      const annStatus = announcement && announcement.active ? `📣 <b>AKTIF</b>\n   Teks: ${escapeHtml(announcement.text || '-')}` : '✅ Tidak aktif';

      return (
        `📊 <b>STATUS WEBSITE</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Maintenance:</b>\n${maintStatus}\n\n` +
        `<b>Banner Website:</b>\n${bannerStatus}\n\n` +
        `<b>Promo Banner:</b>\n${promoStatus}\n\n` +
        `<b>Pengumuman Popup:</b>\n${annStatus}\n` +
        `━━━━━━━━━━━━━━\n` +
        `Diubah: ${warning.updatedAt || '-'}`
      );
    }

    // ================= [1-6] BRANDING WEBSITE =================
    case '/setbrand': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setbrand Cyronime</code>';
      return await mutateSite(s => { s.brandName = val; }, `✅ Nama brand diubah jadi <b>${escapeHtml(val)}</b>.`);
    }

    case '/settagline': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/settagline Layanan Aktivasi Premium</code>';
      return await mutateSite(s => { s.tagline = val; }, `✅ Tagline diubah jadi:\n<i>${escapeHtml(val)}</i>`);
    }

    case '/setfootertext': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setfootertext Created by NAMA_KAMU</code>';
      return await mutateSite(s => { s.footerText = val; }, `✅ Teks footer diubah jadi:\n${escapeHtml(val)}`);
    }

    case '/setfavicon': {
      const url = args[0];
      if (!url) return '📝 Format:\n<code>/setfavicon https://domain.com/favicon.png</code>';
      return await mutateSite(s => { s.faviconUrl = url; }, `✅ Favicon website diubah.`);
    }

    case '/setlogo': {
      const urlArg = args[0];
      if (urlArg === 'reset') {
        return await mutateSite(s => { s.logoUrl = ''; }, `🔄 Logo dikembalikan ke default (huruf inisial brand).`);
      }
      if (message.photo) {
        const rawUrl = await uploadTelegramPhotoToGithub(botToken, message, 'assets/logo');
        return await mutateSite(s => { s.logoUrl = rawUrl; }, `✅ <b>Logo website diperbarui</b> dari foto yang kamu kirim.\n<code>${rawUrl}</code>`);
      }
      if (!urlArg) {
        return (
          '📝 <b>Cara Ganti Logo:</b>\n\n' +
          '1. Kirim foto dengan caption <code>/setlogo</code>\n' +
          '2. Atau ketik <code>/setlogo https://domain.com/logo.png</code>\n' +
          '3. Ketik <code>/setlogo reset</code> buat balik ke huruf inisial brand.'
        );
      }
      return await mutateSite(s => { s.logoUrl = urlArg; }, `✅ Logo website diubah.`);
    }

    case '/seticon': {
      const id = (args[0] || '').toLowerCase();
      if (!id) {
        return (
          '📝 <b>Cara Ganti Icon Layanan:</b>\n\n' +
          'Kirim foto dengan caption:\n<code>/seticon id-layanan</code>\n\n' +
          'Contoh: kirim foto lalu tulis caption <code>/seticon capcut-pro</code>\n\n' +
          'Ketik /listservice buat lihat ID layanan.'
        );
      }
      if (!message.photo) {
        return `⚠️ Kirim <b>foto</b> (bukan file dokumen) dengan caption <code>/seticon ${escapeHtml(id)}</code>`;
      }

      const { services, sha } = await getServicesFile();
      const idx = services.findIndex(s => s.id === id);
      if (idx === -1) return `⚠️ Layanan <code>${id}</code> tidak ditemukan.\n\nKetik /listservice buat lihat daftar.`;

      const rawUrl = await uploadTelegramPhotoToGithub(botToken, message, `assets/icons/${id}`);
      services[idx].icon = rawUrl;
      await saveServicesFile(services, sha, `Update icon layanan: ${id}`);

      return (
        `🖼️ <b>Icon Layanan Diperbarui</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `ID    : <code>${id}</code>\n` +
        `Icon  : <code>${rawUrl}</code>\n` +
        `━━━━━━━━━━━━━━\n` +
        `Refresh portal buat lihat icon baru.`
      );
    }

    case '/sethero': {
      if (args[0] === 'reset' || args[0] === 'hapus') {
        return await mutateSite(s => { s.heroImage = ''; }, `🔄 Background header dikembalikan ke default.`);
      }
      if (!message.photo) {
        return (
          '📝 <b>Cara Ganti Background Header:</b>\n\n' +
          'Kirim foto dengan caption <code>/sethero</code>\n\n' +
          'Ketik <code>/sethero reset</code> buat balik ke default.'
        );
      }
      const rawUrl = await uploadTelegramPhotoToGithub(botToken, message, 'assets/hero');
      return await mutateSite(s => { s.heroImage = rawUrl; }, `🖼️ <b>Background header berhasil diperbarui!</b>\nRefresh website buat lihat perubahan.\n<code>${rawUrl}</code>`);
    }

    case '/settitle': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/settitle Judul Tab Browser</code>';
      return await mutateSite(s => { s.pageTitle = val; }, `✅ Judul tab browser diubah jadi:\n<i>${escapeHtml(val)}</i>`);
    }

    // ================= [7-10] TEMA WARNA =================
    case '/setprimarycolor': {
      const hex = args[0];
      if (!isHexColor(hex)) return '📝 Format:\n<code>/setprimarycolor #D6A755</code>\n\nHarus kode warna hex, contoh: #D6A755';
      return await mutateSite(s => { s.primaryColor = hex; }, `✅ Warna utama (kuning) diubah jadi <b>${hex}</b>.`);
    }

    case '/setaccentcolor': {
      const hex = args[0];
      if (!isHexColor(hex)) return '📝 Format:\n<code>/setaccentcolor #5C8AA6</code>\n\nHarus kode warna hex, contoh: #5C8AA6';
      return await mutateSite(s => { s.accentColor = hex; }, `✅ Warna aksen (hijau) diubah jadi <b>${hex}</b>.`);
    }

    case '/setbgcolor': {
      const hex = args[0];
      if (!isHexColor(hex)) return '📝 Format:\n<code>/setbgcolor #0F1015</code>\n\nHarus kode warna hex, contoh: #0F1015';
      return await mutateSite(s => { s.bgColor = hex; }, `✅ Warna background website diubah jadi <b>${hex}</b>.`);
    }

    case '/resettheme': {
      return await mutateSite(s => {
        s.primaryColor = DEFAULT_WARNING.site.primaryColor;
        s.accentColor = DEFAULT_WARNING.site.accentColor;
        s.bgColor = DEFAULT_WARNING.site.bgColor;
      }, `🔄 Tema warna website dikembalikan ke default.`);
    }

    // ================= [11-13] KONTAK =================
    case '/setwa': {
      const num = (args[0] || '').replace(/[^0-9]/g, '');
      if (!num) return '📝 Format:\n<code>/setwa 6281234567890</code>\n\nGunakan format internasional tanpa + atau 0 di depan.';
      return await mutateSite(s => { s.waNumber = num; }, `✅ Nomor WhatsApp tujuan diubah jadi <b>${num}</b>.`);
    }

    case '/setwamsg': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setwamsg Halo, saya butuh bantuan...</code>';
      return await mutateSite(s => { s.waMessage = val; }, `✅ Template pesan WhatsApp diubah.`);
    }

    case '/setsocial': {
      const [platform, url] = args;
      if (!platform || !url) return '📝 Format:\n<code>/setsocial instagram https://instagram.com/kamu</code>';
      const key = platform.toLowerCase();
      return await mutateSite(s => {
        if (!s.social) s.social = {};
        s.social[key] = url;
      }, `✅ Link ${escapeHtml(key)} diatur ke:\n${escapeHtml(url)}`);
    }

    // ================= [14-15] PROMO BANNER =================
    case '/setpromo': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setpromo Diskon 20% khusus hari ini!</code>';
      return await mutateSite(s => {
        if (!s.promo) s.promo = {};
        s.promo.active = true;
        s.promo.text = val;
      }, `🎉 Promo banner diaktifkan:\n${escapeHtml(val)}`);
    }

    case '/clearpromo': {
      return await mutateSite(s => {
        if (!s.promo) s.promo = {};
        s.promo.active = false;
      }, `✅ Promo banner disembunyikan.`);
    }

    // ================= [16-18] KONTEN TAMBAHAN =================
    case '/setfaq': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setfaq Q: Kenapa email tidak terkirim? A: ...</code>\n\nKetik <code>/setfaq off</code> buat sembunyikan.';
      return await mutateSite(s => { s.faq = val === 'off' ? '' : val; }, `✅ Konten FAQ website diperbarui.`);
    }

    case '/settestimoni': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/settestimoni "Prosesnya cepat banget!" - Budi</code>\n\nKetik <code>/settestimoni off</code> buat sembunyikan.';
      return await mutateSite(s => { s.testimoni = val === 'off' ? '' : val; }, `✅ Testimoni website diperbarui.`);
    }

    case '/setstock': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setstock Stok tersedia: 24 slot</code>\n\nKetik <code>/setstock off</code> buat sembunyikan.';
      return await mutateSite(s => { s.stock = val === 'off' ? '' : val; }, `✅ Label stok website diperbarui.`);
    }

    // ================= [19-22] MODE AKTIVASI =================
    case '/enablemode':
    case '/disablemode': {
      const mode = (args[0] || '').toLowerCase();
      if (!VALID_MODES.includes(mode)) return `📝 Format:\n<code>${cmd} pribadi|generate|buyer</code>`;
      const enabled = cmd === '/enablemode';
      return await mutateSite(s => {
        if (!s.modes) s.modes = {};
        if (!s.modes[mode]) s.modes[mode] = { enabled: true, label: '', badge: '' };
        s.modes[mode].enabled = enabled;
      }, `✅ Mode <b>${mode}</b> ${enabled ? 'diaktifkan' : 'dinonaktifkan'} di website.`);
    }

    case '/setmodelabel': {
      const [mode, ...rest] = args;
      const label = rest.join(' ').trim();
      if (!VALID_MODES.includes((mode || '').toLowerCase()) || !label) {
        return '📝 Format:\n<code>/setmodelabel pribadi Akun Sendiri</code>\n\nKetik label "reset" buat balik ke default.';
      }
      const m = mode.toLowerCase();
      return await mutateSite(s => {
        if (!s.modes) s.modes = {};
        if (!s.modes[m]) s.modes[m] = { enabled: true, label: '', badge: '' };
        s.modes[m].label = label.toLowerCase() === 'reset' ? '' : label;
      }, `✅ Label tab <b>${m}</b> diubah jadi:\n${escapeHtml(label)}`);
    }

    case '/setbadge': {
      const [mode, ...rest] = args;
      const badge = rest.join(' ').trim();
      if (!VALID_MODES.includes((mode || '').toLowerCase()) || !badge) {
        return '📝 Format:\n<code>/setbadge generate BARU</code>\n\nKetik badge "off" buat menghapus.';
      }
      const m = mode.toLowerCase();
      return await mutateSite(s => {
        if (!s.modes) s.modes = {};
        if (!s.modes[m]) s.modes[m] = { enabled: true, label: '', badge: '' };
        s.modes[m].badge = badge.toLowerCase() === 'off' ? '' : badge;
      }, `✅ Badge tab <b>${m}</b> diubah jadi:\n${badge.toLowerCase() === 'off' ? '(dihapus)' : escapeHtml(badge)}`);
    }

    // ================= [23-25] ADMIN TAMBAHAN =================
    case '/addadmin': {
      const id = (args[0] || '').trim();
      if (!id || !/^-?\d+$/.test(id)) return '📝 Format:\n<code>/addadmin 123456789</code>\n\nChat ID bisa didapat dari @userinfobot.';
      const { warning, sha } = await getSiteConfig();
      if (!Array.isArray(warning.admins)) warning.admins = [];
      if (warning.admins.map(String).includes(id)) return `⚠️ Chat ID <code>${id}</code> sudah jadi admin.`;
      warning.admins.push(id);
      warning.updatedAt = new Date().toISOString();
      await saveSiteConfig(warning, sha, `Tambah admin ${id}`);
      return `✅ Chat ID <code>${id}</code> berhasil ditambahkan sebagai admin bot.`;
    }

    case '/deladmin': {
      const id = (args[0] || '').trim();
      if (!id) return '📝 Format:\n<code>/deladmin 123456789</code>';
      const { warning, sha } = await getSiteConfig();
      warning.admins = (warning.admins || []).filter(a => String(a) !== id);
      warning.updatedAt = new Date().toISOString();
      await saveSiteConfig(warning, sha, `Hapus admin ${id}`);
      return `🗑️ Chat ID <code>${id}</code> dihapus dari daftar admin tambahan.`;
    }

    case '/listadmin': {
      const envIds = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const { warning } = await getSiteConfig();
      const extra = warning.admins || [];
      return (
        `👑 <b>Daftar Admin Bot</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Admin utama (env):</b>\n${envIds.map(i => `• <code>${i}</code>`).join('\n') || '(kosong)'}\n\n` +
        `<b>Admin tambahan (/addadmin):</b>\n${extra.map(i => `• <code>${i}</code>`).join('\n') || '(kosong)'}`
      );
    }

    // ================= [26-27] KONFIGURASI =================
    case '/getconfig': {
      const { warning } = await getSiteConfig();
      const json = JSON.stringify(warning.site, null, 2);
      const trimmed = json.length > 3500 ? json.slice(0, 3500) + '\n...(dipotong)' : json;
      return `⚙️ <b>Konfigurasi Website Saat Ini</b>\n━━━━━━━━━━━━━━\n<pre>${escapeHtml(trimmed)}</pre>`;
    }

    case '/resetconfig': {
      const { sha } = await getSiteConfig();
      const fresh = JSON.parse(JSON.stringify(DEFAULT_WARNING));
      fresh.admins = (await getSiteConfig()).warning.admins || []; // jangan hapus daftar admin tambahan
      fresh.updatedAt = new Date().toISOString();
      await saveSiteConfig(fresh, sha, 'Reset konfigurasi website ke default');
      return `🔄 <b>Semua konfigurasi tampilan website dikembalikan ke default.</b>\nToken seller & daftar admin TIDAK terhapus.`;
    }

    // ================= KELOLA LAYANAN (SERVICES / SUPERAPP) =================
    case '/addservice': {
      // Format: /addservice Nama | Deskripsi | /page.html | fa-icon | #color
      const parts = restArgs.split('|').map(s => s.trim());
      if (parts.length < 3) {
        return (
          '📝 <b>Format:</b>\n<code>/addservice Nama | Deskripsi | /halaman.html | fa-icon | #warna</code>\n\n' +
          'Contoh:\n<code>/addservice Capcut Pro | Edit video premium | /capcut.html | fa-scissors | #00E5FF</code>\n\n' +
          'Icon: nama FontAwesome tanpa prefix (contoh: fa-bolt, fa-scissors)\n' +
          'Warna: kode hex (opsional, default kuning)'
        );
      }
      const [name, description, page, icon, color] = parts;
      if (!name || !page) return '❌ Nama dan halaman wajib diisi.';

      const { services, sha } = await getServicesFile();
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      if (services.some(s => s.id === id)) {
        return `⚠️ Layanan dengan ID <code>${id}</code> sudah ada.\nPakai /delservice dulu kalau mau replace.`;
      }

      services.push({
        id,
        name,
        description: description || '',
        page,
        icon: icon || 'fa-globe',
        color: isHexColor(color) ? color : '#D6A755',
        locked: false,
        lockMessage: '',
        order: services.length
      });

      await saveServicesFile(services, sha, `Tambah layanan: ${name}`);
      return (
        `✅ <b>Layanan Berhasil Ditambahkan</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `ID    : <code>${id}</code>\n` +
        `Nama  : ${escapeHtml(name)}\n` +
        `Halaman: <code>${escapeHtml(page)}</code>\n` +
        `Icon  : ${icon || 'fa-globe'}\n` +
        `Warna : ${isHexColor(color) ? color : '#D6A755'}\n` +
        `━━━━━━━━━━━━━━\n` +
        `Layanan sudah tampil di portal.`
      );
    }

    case '/delservice': {
      const id = args[0]?.toLowerCase();
      if (!id) return '📝 Format:\n<code>/delservice alight-motion-premium</code>\n\nKetik /listservice buat lihat ID.';

      const { services, sha } = await getServicesFile();
      const idx = services.findIndex(s => s.id === id);
      if (idx === -1) return `⚠️ Layanan <code>${id}</code> tidak ditemukan.\n\nKetik /listservice buat lihat daftar.`;

      const removed = services.splice(idx, 1)[0];
      // Reorder
      services.forEach((s, i) => { s.order = i; });
      await saveServicesFile(services, sha, `Hapus layanan: ${removed.name}`);
      return `🗑️ Layanan <b>${escapeHtml(removed.name)}</b> berhasil dihapus dari portal.`;
    }

    case '/lockservice': {
      const id = args[0]?.toLowerCase();
      if (!id) return '📝 Format:\n<code>/lockservice alight-motion-premium [pesan kunci]</code>';
      const lockMsg = args.slice(1).join(' ').trim() || 'Layanan ini sedang dikunci sementara.';

      const { services, sha } = await getServicesFile();
      const svc = services.find(s => s.id === id);
      if (!svc) return `⚠️ Layanan <code>${id}</code> tidak ditemukan.`;

      svc.locked = true;
      svc.lockMessage = lockMsg;
      await saveServicesFile(services, sha, `Kunci layanan: ${svc.name}`);
      return (
        `🔒 <b>Layanan Dikunci</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `Layanan: ${escapeHtml(svc.name)}\n` +
        `Pesan  : ${escapeHtml(lockMsg)}\n` +
        `━━━━━━━━━━━━━━\n` +
        `Pengunjung tidak bisa mengakses layanan ini sampai di-unlock.`
      );
    }

    case '/unlockservice': {
      const id = args[0]?.toLowerCase();
      if (!id) return '📝 Format:\n<code>/unlockservice alight-motion-premium</code>';

      const { services, sha } = await getServicesFile();
      const svc = services.find(s => s.id === id);
      if (!svc) return `⚠️ Layanan <code>${id}</code> tidak ditemukan.`;

      svc.locked = false;
      svc.lockMessage = '';
      await saveServicesFile(services, sha, `Buka kunci layanan: ${svc.name}`);
      return `🔓 Layanan <b>${escapeHtml(svc.name)}</b> berhasil dibuka kuncinya.`;
    }

    case '/listservice': {
      const { services } = await getServicesFile();
      if (services.length === 0) return '📋 Belum ada layanan terdaftar.';

      const lines = services.map((s, i) => {
        const lock = s.locked ? ' 🔒' : '';
        const colorDot = s.color || '#D6A755';
        return `${i + 1}. <code>${s.id}</code>${lock}\n   📛 ${escapeHtml(s.name)}\n   📄 ${escapeHtml(s.description || '-')}\n   🎨 <code>${colorDot}</code> | ${s.icon || 'fa-globe'}`;
      });
      return `📋 <b>Daftar Layanan</b> (${services.length})\n━━━━━━━━━━━━━━\n${lines.join('\n\n')}`;
    }

    case '/orderservice': {
      const id = args[0]?.toLowerCase();
      const pos = parseInt(args[1], 10);
      if (!id || isNaN(pos)) return '📝 Format:\n<code>/orderservice alight-motion-premium 0</code>\n\n0 = paling atas.';

      const { services, sha } = await getServicesFile();
      const idx = services.findIndex(s => s.id === id);
      if (idx === -1) return `⚠️ Layanan <code>${id}</code> tidak ditemukan.`;

      const [item] = services.splice(idx, 1);
      services.splice(pos, 0, item);
      services.forEach((s, i) => { s.order = i; });
      await saveServicesFile(services, sha, `Ubah urutan layanan: ${item.name} ke posisi ${pos}`);
      return `✅ Layanan <b>${escapeHtml(item.name)}</b> dipindah ke posisi <b>${pos}</b>.`;
    }



    // ================= INFO REPO =================
    case '/projectinfo': {
      const tokensPath = process.env.GITHUB_TOKENS_PATH || '(belum diset)';
      const projectPath = process.env.GITHUB_PROJECT_PATH || '(pakai repo yang sama dengan tokens)';
      return (
        `📦 <b>Info Repo GitHub</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Data Files:</b>\n<code>${escapeHtml(tokensPath)}</code>\n\n` +
        `<b>Code Files (API + HTML):</b>\n<code>${escapeHtml(projectPath)}</code>\n\n` +
        `━━━━━━━━━━━━━━\n` +
        `Kalau repo kode beda dengan repo data,\n` +
        `set <code>GITHUB_PROJECT_PATH = username/repo/branch</code>\n` +
        `di Environment Variables Vercel.`
      );
    }

    // ================= KELOLA FILE API & HTML (SUPERAPP) =================
    case '/addapi': {
      // Format: /addapi nama [template]
      const name = (args[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const template = (args[1] || 'blank').toLowerCase();
      if (!name) return '📝 Format:\n<code>/addapi nama [blank|proxy|json]</code>\n\nContoh: <code>/addapi capcut proxy</code>\n\nTemplate:\n• <code>blank</code> — handler kosong\n• <code>proxy</code> — proxy (teruskan request ke URL)\n• <code>json</code> — return JSON sederhana';

      const filePath = `api/${name}.js`;
      const { content: existing, sha } = await getProjectFile(filePath);
      if (existing !== null) return `⚠️ File <code>${filePath}</code> sudah ada.\nPakai /delapi dulu kalau mau replace.`;

      const templates = {
        blank: `// Auto-generated via Telegram bot. Edit sesuai kebutuhan.\nexport default async function handler(req, res) {\n  return res.status(200).json({ success: true, message: 'Hello from ${name}' });\n}\n`,
        proxy: `// Auto-generated via Telegram bot. Proxy endpoint.\nexport default async function handler(req, res) {\n  const targetUrl = req.query.url || '';\n  if (!targetUrl) return res.status(400).json({ error: 'Missing url param' });\n  try {\n    const r = await fetch(targetUrl);\n    const data = await r.text();\n    return res.status(r.status).send(data);\n  } catch (e) {\n    return res.status(500).json({ error: e.message });\n  }\n}\n`,
        json: `// Auto-generated via Telegram bot. JSON response.\nexport default async function handler(req, res) {\n  return res.status(200).json({\n    success: true,\n    service: '${name}',\n    data: {}\n  });\n}\n`
      };

      const code = templates[template] || templates.blank;
      await saveProjectFile(filePath, code, null, `Tambah API: ${name} (${template})`);
      return `✅ <b>File API Dibuat</b>\n━━━━━━━━━━━━━━\nFile  : <code>${filePath}</code>\nTemplate: ${template}\n━━━━━━━━━━━━━━\nFile sudah ada di repo GitHub.\nKalau Vercel auto-deploy dari repo ini, file langsung aktif.`;
    }

    case '/delapi': {
      const name = (args[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (!name) return '📝 Format:\n<code>/delapi nama</code>\n\nContoh: <code>/delapi capcut</code>';

      const filePath = `api/${name}.js`;
      const { content: existing, sha } = await getProjectFile(filePath);
      if (existing === null) return `⚠️ File <code>${filePath}</code> tidak ditemukan.`;

      await deleteProjectFile(filePath, sha, `Hapus API: ${name}`);
      return `🗑️ File <code>${filePath}</code> berhasil dihapus dari repo.`;
    }

    case '/addpage': {
      // Format: /addpage nama [judul]
      // Bisa diketik biasa (template kosong), atau sambil:
      //   - reply ke file dengan /addpage nama Judul
      //   - kirim file dengan caption /addpage nama Judul
      const name = (args[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const title = args.slice(1).join(' ').trim() || name;
      if (!name) return '📝 <b>Format:</b>\n<code>/addpage nama [Judul]</code>\n\nContoh: <code>/addpage nonton-anime Nonton Anime</code>\n\n<b>💡 Upload file langsung:</b>\n1. Reply ke file dengan <code>/addpage nama Judul</code>\n2. Atau kirim file dengan caption <code>/addpage nama Judul</code>\n\nKalau tanpa file, template kosong akan dibuat.\nFile akan dibuat: <code>nama.html</code>';

      const filePath = `${name}.html`;
      const { content: existing, sha } = await getProjectFile(filePath);
      if (existing !== null) return `⚠️ File <code>${filePath}</code> sudah ada.\nPakai /delpage dulu kalau mau replace.`;

      // Cek apakah ada file yang di-reply atau di-caption
      const attachedDoc = message.document || (message.reply_to_message && message.reply_to_message.document);
      let html;
      let usedCustomFile = false;

      if (attachedDoc) {
        // Download file dari Telegram
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${attachedDoc.file_id}`);
        const fileData = await fileRes.json();
        if (!fileData.ok || !fileData.result?.file_path) {
          throw new Error(`Gagal ambil file dari Telegram: ${fileData.description || 'Unknown error'}`);
        }
        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        const dlRes = await fetch(downloadUrl);
        if (!dlRes.ok) throw new Error('Gagal mengunduh file dari server Telegram.');
        html = await dlRes.text();
        usedCustomFile = true;
      } else {
        // Template default kosong
        const safeTitle = escapeHtml(title);
        const safeName = escapeHtml(name);
        html = [
          '<!DOCTYPE html>',
          '<html lang="id">',
          '<head>',
          '  <meta charset="UTF-8">',
          '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
          '  <title>' + safeTitle + '</title>',
          '  <script src="https://cdn.tailwindcss.com"><\/script>',
          '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">',
          '  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Space+Grotesk:wght@700;800&display=swap" rel="stylesheet">',
          '  <style>',
          '    body { font-family: \'Plus Jakarta Sans\', sans-serif; background: #0F1015; color: #fff; }',
          '    .nb-shadow { box-shadow: 4px 4px 0px 0px #000; }',
          '  <\/style>',
          '<\/head>',
          '<body class="min-h-screen flex flex-col items-center justify-center p-4">',
          '  <a href="/" class="mb-4 inline-flex items-center gap-2 bg-slate-800 border-2 border-black rounded-xl px-4 py-2 text-xs font-bold text-slate-300 nb-shadow">',
          '    <i class="fas fa-arrow-left"><\/i> Kembali ke Portal',
          '  <\/a>',
          '  <div class="bg-slate-800 border-2 border-black rounded-2xl p-8 nb-shadow max-w-md text-center">',
          '    <h1 class="text-2xl font-extrabold mb-2">' + safeTitle + '<\/h1>',
          '    <p class="text-sm text-slate-400">Halaman ini belum dikustomisasi. Edit file <code>' + safeName + '.html</code> di repo GitHub.</p>',
          '  <\/div>',
          '<\/body>',
          '<\/html>',
          ''
        ].join('\n');
      }

      await saveProjectFile(filePath, html, null, `Tambah halaman: ${name}.html${usedCustomFile ? ' (dari file upload)' : ''}`);

      // Auto-add service entry ke services.json supaya langsung tampil di portal
      try {
        const { services, sha: svcSha } = await getServicesFile();
        if (!services.some(s => s.id === name)) {
          services.push({
            id: name,
            name: title,
            description: '',
            page: '/' + filePath,
            icon: 'fa-globe',
            color: '#D6A755',
            locked: false,
            lockMessage: '',
            order: services.length
          });
          await saveServicesFile(services, svcSha, `Auto-add service: ${name} (via /addpage)`);
        }
      } catch (svcErr) {
        console.error('Gagal auto-add service:', svcErr.message);
      }

      return `✅ <b>Halaman HTML Dibuat & Ditambahkan ke Portal</b>\n━━━━━━━━━━━━━━\nFile  : <code>${filePath}</code>\nJudul : ${escapeHtml(title)}\nSumber: ${usedCustomFile ? '📤 File upload' : '📝 Template kosong'}\n━━━━━━━━━━━━━━\n✅ Layanan otomatis masuk ke services.json\n${usedCustomFile ? 'Isi halaman dari file yang kamu kirim.' : 'Edit langsung di repo GitHub atau Vercel dashboard.'}\nGunakan /seticon ${name} buat ganti icon layanan.`;
    }

    case '/delpage': {
      const name = (args[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (!name) return '📝 Format:\n<code>/delpage nama</code>\n\nContoh: <code>/delpage capcut</code>';

      const filePath = `${name}.html`;
      const { content: existing, sha } = await getProjectFile(filePath);
      if (existing === null) return `⚠️ File <code>${filePath}</code> tidak ditemukan.`;

      await deleteProjectFile(filePath, sha, `Hapus halaman: ${name}.html`);

      // Auto-remove service entry dari services.json
      try {
        const { services, sha: svcSha } = await getServicesFile();
        const svcIdx = services.findIndex(s => s.id === name);
        if (svcIdx !== -1) {
          services.splice(svcIdx, 1);
          services.forEach((s, i) => { s.order = i; });
          await saveServicesFile(services, svcSha, `Auto-remove service: ${name} (via /delpage)`);
        }
      } catch (svcErr) {
        console.error('Gagal auto-remove service:', svcErr.message);
      }

      return `🗑️ File <code>${filePath}</code> berhasil dihapus dari repo.\n✅ Layanan juga dihapus dari services.json (jika ada).`;
    }

    case '/listfiles': {
      try {
        const rootFiles = await listProjectFiles('');
        const apiFiles = await listProjectFiles('api');
        const rootHtml = rootFiles.filter(f => f.name.endsWith('.html')).map(f => `📄 <code>${f.name}</code>`).join('\n') || '(kosong)';
        const apiJs = apiFiles.filter(f => f.name.endsWith('.js')).map(f => `⚙️ <code>api/${f.name}</code>`).join('\n') || '(kosong)';
        return `📂 <b>File di Repo GitHub</b>\n━━━━━━━━━━━━━━\n<b>Halaman HTML:</b>\n${rootHtml}\n\n<b>API Endpoints:</b>\n${apiJs}`;
      } catch (e) {
        return `❌ Gagal list file: <code>${escapeHtml(e.message)}</code>`;
      }
    }

    // ================= [28-29] BACKUP / RESTORE =================
    case '/backup': {
      const { warning } = await getSiteConfig();
      const { tokens } = await getTokensFile();
      const backup = { exportedAt: new Date().toISOString(), warning, tokens };
      const json = JSON.stringify(backup, null, 2);
      if (json.length <= 3800) {
        return `💾 <b>Backup Konfigurasi Website</b>\n━━━━━━━━━━━━━━\n<pre>${escapeHtml(json)}</pre>\n\nSimpan JSON ini buat /restore kapan-kapan.`;
      }
      return (
        `💾 <b>Backup terlalu besar buat dikirim sebagai teks.</b>\n` +
        `Gunakan <code>/getconfig</code> buat lihat konfigurasi tampilan, atau minta developer export manual dari GitHub (file warning.json & tokens.json).`
      );
    }

    // /restore ditangani terpisah di handler() karena butuh akses ke file upload.

    // ================= [30] PENGUMUMAN POPUP =================
    case '/setannouncement': {
      const val = restArgs.trim();
      if (!val) return '📝 Format:\n<code>/setannouncement Promo spesial bulan ini!</code>\n\nKetik <code>/setannouncement off</code> buat matikan.';
      if (val.toLowerCase() === 'off') {
        return await mutateSite(s => {
          if (!s.announcement) s.announcement = {};
          s.announcement.active = false;
        }, `✅ Pengumuman popup dimatikan.`);
      }
      return await mutateSite(s => {
        if (!s.announcement) s.announcement = {};
        s.announcement.active = true;
        s.announcement.text = val;
      }, `📣 Pengumuman popup diaktifkan:\n${escapeHtml(val)}`);
    }

    // ================= KUSTOMISASI PROFIL BOT TELEGRAM =================
    case '/setbotname':
    case '/setname': {
      const name = args.join(' ').trim();
      if (!name) return '📝 Format:\n<code>/setbotname Nama Baru Bot</code>';
      await setBotName(botToken, name);
      return `✅ Nama bot berhasil diubah menjadi: <b>${escapeHtml(name)}</b>`;
    }

    case '/setdescription':
    case '/setdesc': {
      const desc = args.join(' ').trim();
      if (!desc) return '📝 Format:\n<code>/setdescription Deskripsi lengkap bot...</code>';
      await setBotDescription(botToken, desc);
      return `✅ Deskripsi bot berhasil diperbarui.`;
    }

    case '/setshortdesc': {
      const shortDesc = args.join(' ').trim();
      if (!shortDesc) return '📝 Format:\n<code>/setshortdesc Deskripsi singkat bot...</code>';
      await setBotShortDescription(botToken, shortDesc);
      return `✅ Deskripsi singkat bot berhasil diperbarui.`;
    }

    case '/setprofile':
    case '/setphoto': {
      const photoUrlArg = args[0] ? args[0].trim() : null;
      return await setBotProfilePhoto(botToken, message, photoUrlArg);
    }

    case '/delfile':
    case '/deletefile': {
      // Format: /delfile path/ke/file.ext
      const filePath = restArgs.trim();
      if (!filePath) {
        return (
          '📝 <b>Format:</b>\n<code>/delfile path/ke/file.ext</code>\n\n' +
          'Contoh:\n' +
          '• <code>/delfile capcut.html</code>\n' +
          '• <code>/delfile api/capcut.js</code>\n' +
          '• <code>/delfile assets/icons/alightmotion.png</code>\n\n' +
          'Ketik /listfiles buat lihat daftar file di repo.'
        );
      }

      const cleanPath = filePath.replace(/^\/+/, '');
      const { content: existing, sha: fileSha } = await getProjectFile(cleanPath);
      if (existing === null) {
        return `⚠️ File <code>${escapeHtml(cleanPath)}</code> tidak ditemukan di repo.\n\nKetik /listfiles buat lihat daftar.`;
      }

      await deleteProjectFile(cleanPath, fileSha, `Hapus file: ${cleanPath} (via /delfile)`);

      // Kalau file HTML di root, auto-remove dari services.json juga
      const isHtmlRoot = cleanPath.endsWith('.html') && !cleanPath.includes('/');
      let autoRemoveMsg = '';
      if (isHtmlRoot) {
        try {
          const svcId = cleanPath.replace(/\.html$/i, '');
          const { services, sha: svcSha } = await getServicesFile();
          const svcIdx = services.findIndex(s => s.id === svcId);
          if (svcIdx !== -1) {
            services.splice(svcIdx, 1);
            services.forEach((s, i) => { s.order = i; });
            await saveServicesFile(services, svcSha, `Auto-remove service: ${svcId} (via /delfile)`);
            autoRemoveMsg = '\n✅ Layanan juga dihapus dari services.json';
          }
        } catch (svcErr) {
          console.error('Gagal auto-remove service:', svcErr.message);
        }
      }

      return (
        `🗑️ <b>File Berhasil Dihapus</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `File  : <code>${escapeHtml(cleanPath)}</code>${autoRemoveMsg}\n` +
        `━━━━━━━━━━━━━━\n` +
        `File tidak bisa di-undo. Kalau salah hapus, upload ulang dengan /uploadfile.`
      );
    }

    case '/uploadfile':
    case '/upload': {
      // Tangani di handler() atas (butuh akses message.document).
      // Tapi kalau user ketik tanpa file, kasih panduan.
      if (!message.document) {
        return (
          '📝 <b>Cara Upload File ke GitHub</b>\n\n' +
          '1. Kirim file (dokumen) dengan caption <code>/uploadfile [path]</code>\n\n' +
          'Contoh:\n' +
          '• <code>/uploadfile</code> → upload ke root repo (contoh: capcut.html)\n' +
          '• <code>/uploadfile api/</code> → upload ke folder api/ (contoh: api/capcut.js)\n' +
          '• <code>/uploadfile assets/icons/</code> → upload ke folder assets/icons/\n\n' +
          'File akan langsung replace kalau sudah ada di repo.\n' +
          'Cek file dengan /listfiles.'
        );
      }
      return '';
    }

    default:
      return '❓ Perintah tidak dikenal. Ketik /help untuk lihat daftar perintah.';
  }
}

// Helper generik: ambil site config, kasih fungsi mutator, simpan balik.
async function mutateSite(mutatorFn, successMsg) {
  const { warning, sha } = await getSiteConfig();
  if (!warning.site) warning.site = {};
  mutatorFn(warning.site);
  warning.updatedAt = new Date().toISOString();
  await saveSiteConfig(warning, sha, 'Update konfigurasi tampilan website');
  return successMsg;
}

function isHexColor(v) {
  return typeof v === 'string' && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v.trim());
}

// /restore — pulihkan config dari file .json yang di-upload dengan caption /restore,
// atau dari JSON mentah yang ditempel setelah command.
// Upload foto yang dikirim admin di Telegram ke repo GitHub (folder assets/),
// lalu balikin raw.githubusercontent.com URL-nya buat dipakai di website.
async function uploadTelegramPhotoToGithub(botToken, message, destPathBase) {
  if (!message.photo || !Array.isArray(message.photo) || message.photo.length === 0) {
    throw new Error('Tidak ada foto yang dikirim. Kirim sebagai FOTO (bukan file dokumen), dengan caption command ini.');
  }
  const largestPhoto = message.photo[message.photo.length - 1];
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${largestPhoto.file_id}`);
  const fileData = await fileRes.json();
  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error(`Gagal ambil file dari Telegram: ${fileData.description || 'Unknown error'}`);
  }

  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
  const imgRes = await fetch(downloadUrl);
  if (!imgRes.ok) throw new Error('Gagal mengunduh foto dari server Telegram.');
  const arrayBuffer = await imgRes.arrayBuffer();

  const extMatch = fileData.result.file_path.split('.').pop();
  const ext = (extMatch && extMatch.length <= 5 ? extMatch : 'jpg').toLowerCase();
  const filePath = `${destPathBase}.${ext}`;
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  let existingSha = null;
  try {
    const existing = await getProjectFile(filePath);
    existingSha = existing.sha;
  } catch {
    // Belum ada file sebelumnya, biarkan sha null (buat file baru).
  }

  await saveProjectBinaryFile(filePath, base64, existingSha, `Upload gambar: ${filePath}`);
  return buildRawGithubUrl(filePath);
}

async function handleRestore(message, botToken) {
  try {
    let raw;
    if (message.document) {
      const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${message.document.file_id}`);
      const fileData = await fileRes.json();
      if (!fileData.ok || !fileData.result?.file_path) {
        throw new Error(`Gagal ambil file dari Telegram: ${fileData.description || 'Unknown error'}`);
      }
      const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
      const dlRes = await fetch(downloadUrl);
      if (!dlRes.ok) throw new Error('Gagal mengunduh file backup.');
      raw = await dlRes.text();
    } else {
      const text = (message.text || '').trim();
      raw = text.replace(/^\/restore\s*/i, '').trim();
    }

    if (!raw) {
      return (
        `📝 <b>Cara Restore Konfigurasi:</b>\n\n` +
        `1. Upload file .json hasil /backup dengan caption <code>/restore</code>\n` +
        `2. Atau ketik <code>/restore {...json...}</code> langsung.`
      );
    }

    const parsed = JSON.parse(raw);
    const backupWarning = parsed.warning || parsed; // dukung format /backup (ada .warning) atau file warning.json langsung

    const { sha } = await getSiteConfig();
    await saveSiteConfig(backupWarning, sha, 'Restore konfigurasi website dari backup');

    if (parsed.tokens) {
      const { sha: tokensSha } = await getTokensFile();
      await saveTokensFile(parsed.tokens, tokensSha, 'Restore token seller dari backup');
    }

    return `✅ <b>Konfigurasi website berhasil direstore dari backup.</b>`;
  } catch (e) {
    return `❌ Gagal restore: <code>${escapeHtml(e.message)}</code>`;
  }
}

// /uploadfile — upload file dokumen dari Telegram ke repo GitHub.
// Format: kirim file dengan caption /uploadfile [path]
// Contoh: /uploadfile api/  → file ditaruh di api/
//         /uploadfile       → file ditaruh di root
async function handleUploadFile(message, botToken) {
  try {
    if (!message.document) {
      return '⚠️ Kirim file (dokumen) dengan caption <code>/uploadfile [path]</code>';
    }

    const caption = (message.caption || message.text || '').trim();
    const parts = caption.split(/\s+/);
    // /uploadfile [optional-path]
    const destDir = parts.slice(1).join(' ').trim() || '';

    const fileName = message.document.file_name || 'unnamed';
    const mime = message.document.mime_type || '';

    // Download file dari Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${message.document.file_id}`);
    const fileData = await fileRes.json();
    if (!fileData.ok || !fileData.result?.file_path) {
      throw new Error(`Gagal ambil file dari Telegram: ${fileData.description || 'Unknown error'}`);
    }

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) throw new Error('Gagal mengunduh file dari server Telegram.');
    const arrayBuffer = await dlRes.arrayBuffer();

    // Tentukan path tujuan di repo
    let filePath;
    if (destDir) {
      // Bersihkan path: hapus leading slash, pastikan ada trailing slash
      const cleanDir = destDir.replace(/^\/+/, '').replace(/\/*$/, '');
      filePath = `${cleanDir}/${fileName}`;
    } else {
      filePath = fileName;
    }

    // Cek apakah file sudah ada (untuk sha replace)
    let existingSha = null;
    try {
      const existing = await getProjectFile(filePath);
      existingSha = existing.sha;
    } catch {
      // Belum ada file sebelumnya
    }

    // Tentukan apakah file binary atau teks
    const isTextFile = /\.(js|html|css|json|md|txt|xml|svg|yml|yaml|sh|env|gitignore|ts|jsx|tsx|py|php|rb|go|rs|java|c|cpp|h|sql|csv|ini|conf|toml)$/i.test(fileName) ||
                       /^text\//.test(mime) ||
                       mime === 'application/json';

    if (isTextFile) {
      // Upload sebagai teks
      const textContent = new TextDecoder('utf-8').decode(arrayBuffer);
      await saveProjectFile(filePath, textContent, existingSha, `Upload file: ${filePath} (via Telegram)`);
    } else {
      // Upload sebagai binary (base64)
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      await saveProjectBinaryFile(filePath, base64, existingSha, `Upload file: ${filePath} (via Telegram)`);
    }

    // Kalau file HTML di root, tanyakan apakah mau auto-add ke services.json
    const isHtmlRoot = filePath.endsWith('.html') && !filePath.includes('/');
    let autoServiceMsg = '';
    if (isHtmlRoot) {
      try {
        const serviceName = fileName.replace(/\.html$/i, '');
        const serviceId = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const { services, sha: svcSha } = await getServicesFile();
        if (!services.some(s => s.id === serviceId)) {
          services.push({
            id: serviceId,
            name: serviceName.charAt(0).toUpperCase() + serviceName.slice(1),
            description: '',
            page: '/' + filePath,
            icon: 'fa-globe',
            color: '#D6A755',
            locked: false,
            lockMessage: '',
            order: services.length
          });
          await saveServicesFile(services, svcSha, `Auto-add service: ${serviceId} (via /uploadfile)`);
          autoServiceMsg = '\n✅ Layanan otomatis ditambahkan ke portal (services.json)';
        }
      } catch (svcErr) {
        console.error('Gagal auto-add service:', svcErr.message);
      }
    }

    return (
      `✅ <b>File Berhasil Diupload ke GitHub</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `File  : <code>${escapeHtml(filePath)}</code>\n` +
      `Ukuran: ${(message.document.file_size || 0).toLocaleString()} bytes\n` +
      `Tipe  : ${isTextFile ? 'Teks' : 'Binary'}${autoServiceMsg}\n` +
      `━━━━━━━━━━━━━━\n` +
      `URL   : <code>${buildRawGithubUrl(filePath)}</code>`
    );
  } catch (e) {
    return `❌ Gagal upload file: <code>${escapeHtml(e.message)}</code>`;
  }
}

// Helper Telegram Bot API untuk kustomisasi profil bot
async function setBotName(botToken, name) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyName`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API Error: ${data.description || 'Gagal mengubah nama bot'}`);
}

async function setBotDescription(botToken, description) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyDescription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API Error: ${data.description || 'Gagal mengubah deskripsi bot'}`);
}

async function setBotShortDescription(botToken, short_description) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyShortDescription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ short_description })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API Error: ${data.description || 'Gagal mengubah deskripsi singkat bot'}`);
}

async function setBotProfilePhoto(botToken, message, photoUrlArg) {
  // Option 1: Admin mengunggah gambar langsung di chat Telegram
  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${largestPhoto.file_id}`);
    const fileData = await fileRes.json();
    if (!fileData.ok || !fileData.result?.file_path) {
      throw new Error(`Gagal mengambil file foto dari Telegram: ${fileData.description || 'Unknown error'}`);
    }

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const imgRes = await fetch(downloadUrl);
    if (!imgRes.ok) throw new Error('Gagal mengunduh foto dari server Telegram.');
    const arrayBuffer = await imgRes.arrayBuffer();

    const formData = new FormData();
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    formData.append('photo', blob, 'profile.jpg');

    const uploadRes = await fetch(`https://api.telegram.org/bot${botToken}/setMyProfilePhoto`, {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.ok) {
      throw new Error(`Gagal memperbarui foto profil: ${uploadData.description || 'Unknown error'}`);
    }
    return `🖼️ <b>Foto profil bot berhasil diperbarui</b> dari gambar yang kamu kirim!`;
  }

  // Option 2: Admin memberikan URL gambar
  if (photoUrlArg) {
    if (!photoUrlArg.startsWith('http://') && !photoUrlArg.startsWith('https://')) {
      return '⚠️ URL gambar harus diawali dengan http:// atau https://';
    }
    const imgRes = await fetch(photoUrlArg);
    if (!imgRes.ok) throw new Error(`Gagal mengunduh gambar dari URL: ${imgRes.statusText}`);
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await imgRes.arrayBuffer();

    const formData = new FormData();
    const blob = new Blob([arrayBuffer], { type: contentType });
    formData.append('photo', blob, 'profile.jpg');

    const uploadRes = await fetch(`https://api.telegram.org/bot${botToken}/setMyProfilePhoto`, {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.ok) {
      throw new Error(`Gagal memperbarui foto profil: ${uploadData.description || 'Unknown error'}`);
    }
    return `🖼️ <b>Foto profil bot berhasil diperbarui</b> dari URL!`;
  }

  // Option 3: Tidak ada gambar/URL yang diberikan
  return (
    `📝 <b>Cara Mengubah Foto Profil Bot:</b>\n\n` +
    `1. Kirim/upload foto di chat Telegram dengan caption <code>/setprofile</code> atau <code>/setphoto</code>\n` +
    `2. Atau ketik perintah dengan URL gambar:\n` +
    `<code>/setprofile https://domain.com/foto.jpg</code>`
  );
}

function usageBar(used, limit) {
  if (limit === -1) return '♾️';
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 1;
  const filled = Math.round(ratio * 8);
  return '▓'.repeat(filled) + '░'.repeat(8 - filled);
}

function parseLimit(raw) {
  if (!raw || raw.toLowerCase() === 'unli' || raw.toLowerCase() === 'unlimited') return -1;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) throw new Error('Limit harus angka positif atau "unli".');
  return n;
}

function formatLimit(limit) {
  return limit === -1 ? 'Unlimited ♾️' : String(limit);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function helpText() {
  return (
    `✨ <b>CYRONIME — BOT ADMIN</b> ✨\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>🔑 Token Seller</b>\n` +
    `/addtoken /setlimit /reset /deltoken /listtoken\n\n` +
    `<b>🛠️ Maintenance & Banner</b>\n` +
    `/maintenance /unmaintenance /warn /danger /info /clearwarn /status\n\n` +
    `<b>🎨 Branding Website (1-6)</b>\n` +
    `/setbrand /settagline /setfootertext /setfavicon /setlogo /settitle\n\n` +
    `<b>🖼️ Gambar (Logo, Header, Icon Layanan)</b>\n` +
    `/setlogo /sethero /seticon\n\n` +
    `<b>🌈 Tema Warna (7-10)</b>\n` +
    `/setprimarycolor /setaccentcolor /setbgcolor /resettheme\n\n` +
    `<b>📞 Kontak (11-13)</b>\n` +
    `/setwa /setwamsg /setsocial\n\n` +
    `<b>🎉 Promo Banner (14-15)</b>\n` +
    `/setpromo /clearpromo\n\n` +
    `<b>📄 Konten Tambahan (16-18)</b>\n` +
    `/setfaq /settestimoni /setstock\n\n` +
    `<b>🔀 Mode Aktivasi (19-22)</b>\n` +
    `/enablemode /disablemode /setmodelabel /setbadge\n\n` +
    `<b>👑 Admin Tambahan (23-25)</b>\n` +
    `/addadmin /deladmin /listadmin\n\n` +
    `<b>⚙️ Konfigurasi (26-27)</b>\n` +
    `/getconfig /resetconfig\n\n` +
    `<b>💾 Backup/Restore (28-29)</b>\n` +
    `/backup /restore\n\n` +
    `<b>🧩 Layanan / Portal Superapp</b>\n` +
    `/addservice /delservice /lockservice /unlockservice /listservice /orderservice\n\n` +
    `<b>📂 File API & HTML</b>\n` +
    `/addapi /delapi /addpage /delpage /listfiles /projectinfo\n\n` +
    `<b>📤 Upload File ke GitHub</b>\n` +
    `/uploadfile — kirim file + caption /uploadfile [path]\n\n` +
    `<b>🗑️ Hapus File dari GitHub</b>\n` +
    `/delfile path/ke/file.ext\n\n` +
    `<b>📣 Pengumuman (30)</b>\n` +
    `/setannouncement\n\n` +
    `<b>🤖 Profil Bot</b>\n` +
    `/setbotname /setdescription /setshortdesc /setprofile\n\n` +
    `<i>Ketik command tanpa argumen buat lihat contoh formatnya masing-masing.</i>`
  );
}

async function sendMessage(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

async function sendPhoto(botToken, chatId, photoUrl, caption) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'sendPhoto failed');
  } catch (e) {
    // Kalau foto gagal kirim, fallback ke teks saja biar user tetap dapat respon
    console.error('sendPhoto gagal, fallback ke sendMessage:', e.message);
    await sendMessage(botToken, chatId, caption || 'Gagal mengirim foto.');
  }
}
