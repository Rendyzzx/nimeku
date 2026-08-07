// Helper kirim notifikasi ke Telegram lewat Bot API.
//
// Env var yang dipakai (SAMA dengan yang dipakai bot admin di api/bot.js):
//   TELEGRAM_BOT_TOKEN = token dari @BotFather (contoh: 123456:ABC-DEF...)
//   TELEGRAM_ADMIN_IDS = chat id tujuan notifikasi, boleh lebih dari satu
//                        dipisah koma (contoh: 111111,222222)
//
// Cara dapat chat ID: chat bot @userinfobot di Telegram, dia balas Id kamu.
//
// (TELEGRAM_CHAT_ID lama masih didukung sebagai fallback kalau kamu masih
// pakai itu, tapi disarankan pindah ke TELEGRAM_ADMIN_IDS saja.)

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function getTargetChatIds() {
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (adminIds.length > 0) return adminIds;

  // Fallback ke env var lama (TELEGRAM_CHAT_ID) kalau masih dipakai.
  const legacy = process.env.TELEGRAM_CHAT_ID;
  return legacy ? [legacy] : [];
}

async function sendRaw(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getTargetChatIds();
  if (!botToken || chatIds.length === 0) return;

  await Promise.all(
    chatIds.map(async chatId => {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        });
      } catch (e) {
        // Jangan sampai kegagalan notif Telegram bikin request utama gagal.
        console.error('Gagal kirim notifikasi Telegram:', e.message);
      }
    })
  );
}

// Notifikasi transaksi/aktivitas normal (bukan error).
async function notifyTelegram(req, { action, detail = {} }) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '-';
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const detailLines = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(String(v))}`)
    .join('\n');

  const text =
    `🔔 <b>${escapeHtml(action)}</b>\n` +
    `<b>Waktu:</b> ${escapeHtml(time)} WIB\n` +
    `<b>IP:</b> <code>${escapeHtml(ip)}</code>\n` +
    `<b>User-Agent:</b> ${escapeHtml(ua)}\n` +
    (detailLines ? `\n${detailLines}` : '');

  await sendRaw(text);
}

// Notifikasi khusus error/gagal — isi pesan error asli biar gampang di-debug.
async function notifyError(req, { action, error, extra = {} }) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '-';
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const errMsg = (error && error.message) ? error.message : String(error);

  const extraLines = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(String(v))}`)
    .join('\n');

  const text =
    `🔴 <b>ERROR: ${escapeHtml(action)}</b>\n` +
    `<b>Waktu:</b> ${escapeHtml(time)} WIB\n` +
    `<b>IP:</b> <code>${escapeHtml(ip)}</code>\n` +
    `<b>User-Agent:</b> ${escapeHtml(ua)}\n` +
    (extraLines ? `${extraLines}\n` : '') +
    `\n<b>Pesan Error:</b>\n<code>${escapeHtml(errMsg)}</code>`;

  await sendRaw(text);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export { notifyTelegram, notifyError, getClientIp };
