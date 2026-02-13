// ═══════════════════════════════════════════════════════════════════
//  POST /api/admin — Queues admin commands for next tick cycle
//  Commands: addAnts, dropFood, togglePause, setSpeed
//  Protected by ADMIN_SECRET env var
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, value, secret } = req.body || {};

  // Validate secret
  const adminSecret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  if (!adminSecret || secret !== adminSecret) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  try {
    // Read existing command queue
    const existing = (await kv.get('colony:admin-commands') as any[]) || [];

    // Add new command
    existing.push({
      action,
      value,
      timestamp: Date.now()
    });

    // Store back (expire after 10 minutes to auto-cleanup)
    await kv.set('colony:admin-commands', existing, { ex: 600 });

    const messages: Record<string, string> = {
      addAnts: 'Spawning 5 new ants',
      dropFood: 'Dropping food near colony',
      togglePause: 'Toggling simulation pause',
      setSpeed: `Speed set to ${value}x`
    };

    return res.status(200).json({
      ok: true,
      message: messages[action] || 'Command queued'
    });
  } catch (error) {
    console.error('Admin error:', error);
    return res.status(500).json({ error: 'Failed to queue command' });
  }
}
