// Gabungan endpoint fitur "Status HD" (antrian video) dalam satu file.
// Digabung supaya jumlah Serverless Function tidak melebihi limit paket
// Vercel Hobby (maks. 12 function per deployment) — sebelumnya ini 3 file
// terpisah (status-pending, status-mark-sent, status-upload).
// (Endpoint /api/status yang lama untuk banner/maintenance TIDAK digabung
// di sini — itu tetap file terpisah, api/status.js.)
//
// Dipanggil dengan ?action=<nama>, contoh: /api/status-hd?action=pending
//
//   GET  ?action=pending    -> dipanggil bot, butuh header x-bot-secret
//   POST ?action=mark-sent  -> dipanggil bot, butuh header x-bot-secret
//   POST ?action=upload     -> dipanggil otomatis oleh @vercel/blob client
//                              upload dari status-hd.html (handleUploadUrl)

import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import {
  saveProjectBinaryFile,
  getStatusQueueFile,
  saveStatusQueueFile,
  deleteProjectFile
} from './_lib/github.js';
import { notifyError } from './_lib/telegram.js';

const MAX_SIZE_BYTES = 64 * 1024 * 1024;
const IDLE_MS = 10 * 60 * 1000; // 10 menit

function randomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function requireBotSecret(req, res) {
  const secret = req.headers['x-bot-secret'];
  if (!process.env.BOT_SECRET || secret !== process.env.BOT_SECRET) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handlePending(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!requireBotSecret(req, res)) return;

  try {
    const { items } = await getStatusQueueFile();
    const pending = items
      .filter(i => i.status === 'pending')
      .map(i => ({ id: i.id, phone: i.phone, path: i.path, uploadedAt: i.uploadedAt }));
    return res.status(200).json({ success: true, items: pending });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function handleMarkSent(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!requireBotSecret(req, res)) return;

  const { id, success: sendOk, error: sendErr } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'id wajib diisi' });

  try {
    const { items, sha } = await getStatusQueueFile();
    const entry = items.find(i => i.id === id);
    if (!entry) return res.status(404).json({ success: false, error: 'Item tidak ditemukan' });

    entry.status = sendOk === false ? 'failed' : 'sent';
    entry.sentAt = new Date().toISOString();
    if (sendErr) entry.error = String(sendErr).slice(0, 300);

    await saveStatusQueueFile(items, sha, `Tandai ${id} sebagai ${entry.status}`);
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function cleanupExpired() {
  const { items, sha } = await getStatusQueueFile();
  const now = Date.now();
  const keep = [];
  const expired = [];

  for (const item of items) {
    const ref = item.status === 'sent' || item.status === 'failed' ? item.sentAt : item.uploadedAt;
    const age = now - new Date(ref || item.uploadedAt).getTime();
    if (age > IDLE_MS) expired.push(item);
    else keep.push(item);
  }
  if (expired.length === 0) return;

  for (const item of expired) {
    try {
      await deleteProjectFile(item.path, item.videoSha, `Bersihkan video kadaluarsa ${item.id}`);
    } catch (e) {
      console.error('Gagal hapus video kadaluarsa dari GitHub:', item.id, e.message);
    }
  }
  await saveStatusQueueFile(keep, sha, `Bersihkan ${expired.length} video kadaluarsa (>10 menit)`);
}

async function handleUploadAction(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let phone = '';
        try { phone = JSON.parse(clientPayload || '{}').phone || ''; } catch { /* ignore */ }
        if (!phone || !/^\d{8,15}$/.test(phone)) {
          throw new Error('Nomor WhatsApp tidak valid.');
        }
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
          maximumSizeInBytes: MAX_SIZE_BYTES,
          addRandomSuffix: true,
          tokenPayload: clientPayload
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let phone = '';
        try { phone = JSON.parse(tokenPayload || '{}').phone || ''; } catch { /* ignore */ }

        try {
          await cleanupExpired();
          if (!phone) throw new Error('Nomor WhatsApp hilang dari payload upload.');

          const videoRes = await fetch(blob.url);
          if (!videoRes.ok) throw new Error('Gagal mengambil video dari Blob sementara.');
          const arrayBuf = await videoRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuf).toString('base64');

          const id = randomId();
          const ext = (blob.pathname.split('.').pop() || 'mp4').toLowerCase();
          const ghPath = `status-videos/${id}.${ext}`;

          const videoSha = await saveProjectBinaryFile(ghPath, base64, null, `Upload status HD ${id} untuk ${phone}`);

          const { items, sha } = await getStatusQueueFile();
          items.push({
            id, phone, path: ghPath, videoSha,
            status: 'pending', uploadedAt: new Date().toISOString(), sentAt: null
          });
          await saveStatusQueueFile(items, sha, `Antre status HD ${id} untuk ${phone}`);
        } finally {
          await del(blob.url).catch(() => {});
        }
      }
    });

    return res.status(200).json(jsonResponse);
  } catch (e) {
    await notifyError(req, { action: 'Upload Status HD', error: e });
    return res.status(400).json({ success: false, error: e.message || 'Gagal upload video.' });
  }
}

export default async function handler(req, res) {
  const action = req.query?.action;
  switch (action) {
    case 'pending':   return handlePending(req, res);
    case 'mark-sent': return handleMarkSent(req, res);
    case 'upload':    return handleUploadAction(req, res);
    default:
      return res.status(400).json({ success: false, error: 'action tidak valid' });
  }
}
