import { getPairingFile } from './_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

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
