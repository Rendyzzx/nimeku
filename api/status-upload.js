// Endpoint upload video untuk fitur "Status HD".
//
// Alur: browser upload video LANGSUNG ke Vercel Blob (bypass limit 4.5MB
// body Vercel Function), lalu Vercel yang memanggil endpoint ini balik
// (webhook onUploadCompleted) untuk memindahkan video itu ke GitHub sebagai
// penyimpanan permanen, dan mendaftarkannya ke statusQueue.json supaya bot
// WhatsApp (di Pterodactyl) bisa mengambil & mengirimnya.
//
// ==== ENV VAR TAMBAHAN ====
//   BLOB_READ_WRITE_TOKEN  -> otomatis terisi kalau kamu sudah connect
//                             Vercel Blob Store ke project ini (Storage tab)
//   GITHUB_STATUS_QUEUE_PATH (opsional, fallback ke repo/branch tokens.json
//                             + statusQueue.json)

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

// Hapus entri antrian yang sudah >10 menit ("sent" dihitung dari sentAt,
// "pending" yang tidak pernah diambil bot dihitung dari uploadedAt).
// Dipanggil "menumpang" di setiap upload baru, jadi tidak butuh cron.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let phone = '';
        try {
          phone = JSON.parse(clientPayload || '{}').phone || '';
        } catch { /* ignore */ }

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
        try {
          phone = JSON.parse(tokenPayload || '{}').phone || '';
        } catch { /* ignore */ }

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

          const videoSha = await saveProjectBinaryFile(
            ghPath, base64, null, `Upload status HD ${id} untuk ${phone}`
          );

          const { items, sha } = await getStatusQueueFile();
          items.push({
            id,
            phone,
            path: ghPath,
            videoSha,
            status: 'pending',
            uploadedAt: new Date().toISOString(),
            sentAt: null
          });
          await saveStatusQueueFile(items, sha, `Antre status HD ${id} untuk ${phone}`);
        } finally {
          // Blob cuma tempat transit — hapus terlepas dari berhasil/gagal
          // supaya tidak menumpuk memakan kuota Blob.
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
