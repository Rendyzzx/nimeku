// Gabungan semua endpoint pairing bot WhatsApp dalam satu file.
// Digabung supaya jumlah Serverless Function tidak melebihi limit paket
// Vercel Hobby (maks. 12 function per deployment) — sebelumnya ini 6 file
// terpisah (pairing-request, pairing-status, pairing-set-code,
// pairing-confirm, pairing-auth, pairing-check).
//
// Dipanggil dengan ?action=<nama>, contoh: /api/pairing?action=status
//
//   GET  ?action=status    -> baca status pairing saat ini (publik, dipanggil
//                             panel admin & bot, TIDAK butuh secret)
//   GET  ?action=check     -> cek apakah browser ini sudah "buka gembok" admin
//   POST ?action=auth      -> submit password gembok admin (body: {password})
//   DEL  ?action=auth      -> logout / kunci lagi panel admin
//   POST ?action=request   -> mulai pairing nomor baru (body: {phone, pat})
//   POST ?action=set-code  -> dipanggil bot: simpan kode pairing (body: {code})
//   POST ?action=confirm   -> dipanggil bot: tandai pairing sukses

import { getPairingFile, savePairingFile } from './_lib/github.js';
import { notifyTelegram, notifyError } from './_lib/telegram.js';
import { buildSessionCookie, clearSessionCookie, isPairingUnlocked } from './_lib/pairingAuth.js';

function requireBotSecret(req, res) {
  const secret = req.headers['x-bot-secret'];
  if (!process.env.BOT_SECRET || secret !== process.env.BOT_SECRET) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handleStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const { pairing } = await getPairingFile();
    return res.status(200).json({
      success: true,
      status: pairing.status,
      phone: pairing.phone,
      code: pairing.status === 'code_ready' ? pairing.code : ''
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function handleCheck(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  return res.status(200).json({ success: true, unlocked: isPairingUnlocked(req) });
}

async function handleAuth(req, res) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ success: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  if (!process.env.PAIRING_PASSWORD) {
    return res.status(500).json({ success: false, error: 'PAIRING_PASSWORD belum diset di Environment Variables Vercel.' });
  }
  const { password } = req.body || {};
  if (!password || password !== process.env.PAIRING_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Password salah.' });
  }
  res.setHeader('Set-Cookie', buildSessionCookie());
  return res.status(200).json({ success: true });
}

async function handleRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { phone: rawPhone, pat } = req.body || {};
  const phone = String(rawPhone || '').replace(/\D/g, '');

  if (!phone || phone.length < 8 || phone.length > 15) {
    return res.status(400).json({ success: false, error: 'Nomor WhatsApp tidak valid.' });
  }
  if (!process.env.GITHUB_PAT || pat !== process.env.GITHUB_PAT) {
    return res.status(401).json({ success: false, error: 'PAT tidak cocok.' });
  }

  try {
    const { pairing, sha } = await getPairingFile();
    if (pairing.status === 'paired') {
      return res.status(409).json({
        success: false,
        error: `Bot sudah paired ke ${pairing.phone}. Reset pairing.json manual di GitHub kalau mau pairing ulang.`
      });
    }

    const next = { phone, status: 'requested', code: '', requestedAt: new Date().toISOString(), pairedAt: null };
    await savePairingFile(next, sha, `Minta pairing bot WA untuk ${phone}`);

    await notifyTelegram(req, { action: 'Permintaan Pairing Bot WA', detail: { Nomor: phone } });
    return res.status(200).json({ success: true });
  } catch (e) {
    await notifyError(req, { action: 'Permintaan Pairing Bot WA', error: e, extra: { Nomor: phone } });
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function handleSetCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!requireBotSecret(req, res)) return;

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: 'code wajib diisi' });

  try {
    const { pairing, sha } = await getPairingFile();
    pairing.status = 'code_ready';
    pairing.code = code;
    await savePairingFile(pairing, sha, `Kode pairing siap untuk ${pairing.phone}`);
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function handleConfirm(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!requireBotSecret(req, res)) return;

  try {
    const { pairing, sha } = await getPairingFile();
    pairing.status = 'paired';
    pairing.pairedAt = new Date().toISOString();
    pairing.code = '';
    await savePairingFile(pairing, sha, `Bot WA berhasil paired: ${pairing.phone}`);

    await notifyTelegram(req, { action: 'Bot WA Berhasil Pairing', detail: { Nomor: pairing.phone } });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default async function handler(req, res) {
  const action = req.query?.action;
  switch (action) {
    case 'status':   return handleStatus(req, res);
    case 'check':    return handleCheck(req, res);
    case 'auth':     return handleAuth(req, res);
    case 'request':  return handleRequest(req, res);
    case 'set-code': return handleSetCode(req, res);
    case 'confirm':  return handleConfirm(req, res);
    default:
      return res.status(400).json({ success: false, error: 'action tidak valid' });
  }
}
