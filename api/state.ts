// ═══════════════════════════════════════════════════════════════════
//  GET /api/state — Returns last checkpoint + AI directive
//  v10: Client runs simulation; server just stores checkpoints
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=5');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const directiveOnly = req.query.directiveOnly === '1';

    if (directiveOnly) {
      // Client just wants the latest AI directive
      const directive = await kv.get('colony:directive');
      return res.status(200).json({ directive: directive || null });
    }

    // Full load: checkpoint + directive
    const [checkpoint, directive] = await Promise.all([
      kv.get('colony:checkpoint'),
      kv.get('colony:directive'),
    ]);

    if (!checkpoint) {
      return res.status(200).json({
        status: 'initializing',
        message: 'No colony checkpoint found. A new colony will be created.',
      });
    }

    return res.status(200).json({
      checkpoint,
      directive: directive || null,
    });
  } catch (error) {
    console.error('Error fetching colony state:', error);
    return res.status(500).json({ error: 'Failed to fetch colony state' });
  }
}
