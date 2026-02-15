// ═══════════════════════════════════════════════════════════════════
//  POST /api/leader — Simple leader election for live shared view
//  Only one client (the leader) saves checkpoints.
//  Others sync from server to see the same colony.
//  Leader lease expires after 60s, allowing another client to take over.
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');

const LEADER_TTL = 60; // Leader lease: 60 seconds

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { session } = req.body;
    if (!session) {
      return res.status(400).json({ error: 'Missing session ID' });
    }

    // Try to get current leader
    const currentLeader = await kv.get('colony:leader');

    if (!currentLeader || currentLeader === session) {
      // No leader or we are the leader — claim/renew lease
      await kv.set('colony:leader', session, { ex: LEADER_TTL });
      return res.status(200).json({ isLeader: true, session });
    }

    // Someone else is leader
    return res.status(200).json({ isLeader: false, session });
  } catch (error) {
    console.error('Leader election error:', error);
    // On error, let everyone be a leader (graceful degradation)
    return res.status(200).json({ isLeader: true });
  }
}
