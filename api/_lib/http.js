// Helper untuk parse response upstream jadi JSON dengan aman.
// Kalau upstream ternyata balikin HTML (halaman error, blokir Cloudflare,
// maintenance page, dll) daripada JSON, ini bakal throw error yang JELAS
// isinya potongan responsenya — bukan cuma "Unexpected token '<'".

async function safeJson(upstreamRes, label = 'Upstream') {
  const raw = await upstreamRes.text();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 200);
    const err = new Error(
      `${label} mengembalikan format tidak valid (HTTP ${upstreamRes.status}), bukan JSON. Kemungkinan server upstream sedang down/maintenance/diblokir. Potongan response: ${snippet}`
    );
    err.httpStatus = upstreamRes.status;
    err.rawSnippet = snippet;
    throw err;
  }

  return parsed;
}

export { safeJson };
