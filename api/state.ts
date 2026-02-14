// ═══════════════════════════════════════════════════════════════════
//  GET /api/state — Returns current colony state for viewer clients
//  Called every 2-5 seconds by browser viewers
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers for cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=5');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch the latest viewer state and directive from KV
    const [viewerState, directive] = await Promise.all([
      kv.get('colony:viewer-state'),
      kv.get('colony:directive'),
    ]);

    if (!viewerState) {
      return res.status(200).json({
        status: 'initializing',
        message: 'Colony is being initialized. Check back in a moment.',
      });
    }

    // Merge directive data into viewer state
    const state = viewerState as any;
    if (directive) {
      const d = directive as any;
      if (d.narration) state.narration = d.narration;
      if (d.insight) state.insight = d.insight;
      if (d.tokenUsage) state.tokenUsage = d.tokenUsage;
    }

    return res.status(200).json(state);
  } catch (error) {
    console.error('Error fetching colony state:', error);
    return res.status(500).json({ error: 'Failed to fetch colony state' });
  }
}
