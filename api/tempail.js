// Proxy server-side untuk tempail.top.
// Endpoint upstream & header di sini TIDAK PERNAH terkirim ke browser client —
// hanya hasil (JSON) yang diteruskan lewat response ini.

import { notifyTelegram, notifyError } from './_lib/telegram.js';
import { safeJson } from './_lib/http.js';

const BASE = 'https://tempail.top/api';
const HEADERS = { 'user-agent': 'Postify/1.0.0' };

export default async function handler(req, res) {
  // Kunci akses hanya ke method GET, hindari penyalahgunaan endpoint ini.
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { action, token, id } = req.query;

  try {
    let upstreamRes;

    if (action === 'create') {
      upstreamRes = await fetch(`${BASE}/email/create/ApiTempail`, {
        method: 'POST',
        headers: HEADERS
      });
      const data = await safeJson(upstreamRes, 'Tempail');
      if (data.status !== 'success') {
        await notifyError(req, {
          action: 'Buat Email Temp (Tempail)',
          error: new Error('Upstream tempail.top tidak sukses.'),
          extra: { 'HTTP Status Upstream': upstreamRes.status, 'Response Upstream': JSON.stringify(data).slice(0, 500) }
        });
        return res.status(200).json({ success: false, error: 'Gagal bikin email temp.' });
      }
      const { email, email_token: emailToken } = data.data;

      await notifyTelegram(req, {
        action: 'Buat Email Temp (Tempail)',
        detail: { Email: email }
      });

      return res.status(200).json({ success: true, email, emailToken });

    } else if (action === 'messages') {
      if (!token) return res.status(400).json({ success: false, error: 'token wajib diisi' });
      upstreamRes = await fetch(`${BASE}/messages/${encodeURIComponent(token)}/ApiTempail`, {
        headers: HEADERS
      });
      const data = await safeJson(upstreamRes, 'Tempail');
      if (data.status !== 'success') {
        await notifyError(req, {
          action: 'Cek List Pesan (Tempail)',
          error: new Error('Upstream tempail.top tidak sukses.'),
          extra: { 'HTTP Status Upstream': upstreamRes.status, 'Response Upstream': JSON.stringify(data).slice(0, 500) }
        });
        return res.status(200).json({ success: false, error: 'Gagal ambil list pesan.' });
      }
      const { mailbox, messages } = data.data;

      await notifyTelegram(req, {
        action: 'Cek List Pesan (Tempail)',
        detail: { Mailbox: mailbox, 'Jumlah Pesan': Array.isArray(messages) ? messages.length : '-' }
      });

      return res.status(200).json({ success: true, mailbox, messages });

    } else if (action === 'message') {
      if (!id) return res.status(400).json({ success: false, error: 'id wajib diisi' });
      upstreamRes = await fetch(`${BASE}/message/${encodeURIComponent(id)}/ApiTempail`, {
        headers: HEADERS
      });
      const data = await safeJson(upstreamRes, 'Tempail');
      if (data.status !== 'success') {
        await notifyError(req, {
          action: 'Buka Isi Pesan (Tempail)',
          error: new Error('Upstream tempail.top tidak sukses.'),
          extra: { 'HTTP Status Upstream': upstreamRes.status, 'Response Upstream': JSON.stringify(data).slice(0, 500) }
        });
        return res.status(200).json({ success: false, error: 'Gagal ambil isi pesan.' });
      }
      const [msg] = data.data;

      await notifyTelegram(req, {
        action: 'Buka Isi Pesan (Tempail)',
        detail: { Subjek: msg.subject, Dari: `${msg.from} <${msg.from_email}>` }
      });

      return res.status(200).json({
        success: true,
        message: {
          subject: msg.subject,
          from: msg.from,
          fromEmail: msg.from_email,
          content: msg.content
        }
      });

    } else {
      return res.status(400).json({ success: false, error: 'action tidak valid' });
    }
  } catch (e) {
    await notifyError(req, {
      action: `Tempail (action=${action || '-'})`,
      error: e,
      extra: { 'HTTP Status Upstream': e.httpStatus }
    });
    return res.status(500).json({ success: false, error: 'Gagal menghubungi server email.' });
  }
}
