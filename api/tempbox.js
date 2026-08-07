// Proxy server-side untuk tempmail.lol (server fallback "Tempbox").
// Sama seperti tempail.js — endpoint upstream disembunyikan dari client.

import { notifyTelegram, notifyError } from './_lib/telegram.js';
import { safeJson } from './_lib/http.js';

const HEADERS = { 'user-agent': 'NB Android/1.0.0' };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { action, token } = req.query;

  try {
    if (action === 'create') {
      const upstreamRes = await fetch('https://api.tempmail.lol/v2/inbox/create', {
        method: 'POST',
        headers: HEADERS
      });
      const data = await safeJson(upstreamRes, 'Tempbox');

      if (!upstreamRes.ok || !data.address) {
        await notifyError(req, {
          action: 'Buat Email Temp (Tempbox)',
          error: new Error('Upstream tempmail.lol tidak mengembalikan alamat email.'),
          extra: { 'HTTP Status Upstream': upstreamRes.status, 'Response Upstream': JSON.stringify(data).slice(0, 500) }
        });
        return res.status(200).json({ success: false, error: 'Gagal bikin email temp.' });
      }

      await notifyTelegram(req, {
        action: 'Buat Email Temp (Tempbox)',
        detail: { Email: data.address }
      });

      return res.status(200).json({ success: true, email: data.address, emailToken: data.token });

    } else if (action === 'messages') {
      if (!token) return res.status(400).json({ success: false, error: 'token wajib diisi' });
      const upstreamRes = await fetch(`https://api.tempmail.lol/v2/inbox?token=${encodeURIComponent(token)}`, {
        headers: HEADERS
      });
      const data = await safeJson(upstreamRes, 'Tempbox');

      if (!upstreamRes.ok) {
        await notifyError(req, {
          action: 'Cek List Pesan (Tempbox)',
          error: new Error('Upstream tempmail.lol gagal.'),
          extra: { 'HTTP Status Upstream': upstreamRes.status, 'Response Upstream': JSON.stringify(data).slice(0, 500) }
        });
        return res.status(200).json({ success: false, error: 'Gagal ambil list pesan.' });
      }

      await notifyTelegram(req, {
        action: 'Cek List Pesan (Tempbox)',
        detail: { 'Jumlah Pesan': (data.emails || []).length }
      });

      return res.status(200).json({ success: true, messages: data.emails || [] });

    } else {
      return res.status(400).json({ success: false, error: 'action tidak valid' });
    }
  } catch (e) {
    await notifyError(req, {
      action: `Tempbox (action=${action || '-'})`,
      error: e,
      extra: { 'HTTP Status Upstream': e.httpStatus }
    });
    return res.status(500).json({ success: false, error: 'Gagal menghubungi server email.' });
  }
}
