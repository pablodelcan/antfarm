// ═══════════════════════════════════════════════════════════════════
//  POST /api/save — Store checkpoint, optionally trigger Claude AI
//  v10: Client sends serialized colony state every ~60s
//  Server stores in KV and calls Claude AI if enough time has passed
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');
import { getColonyDirective, getTokenUsage } from '../lib/claude';

const AI_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between AI calls

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { state: checkpoint, session, snapshot } = req.body;

    if (!checkpoint) {
      return res.status(400).json({ error: 'Missing checkpoint data' });
    }

    // Store the checkpoint
    await kv.set('colony:checkpoint', checkpoint, { ex: 86400 * 7 }); // 7-day TTL

    // Check if we should trigger Claude AI
    let directive = null;
    const lastAiCall = await kv.get('colony:last-ai-call');
    const now = Date.now();

    if (!lastAiCall || (now - lastAiCall) > AI_COOLDOWN_MS) {
      // Build snapshot for Claude from checkpoint data
      const aiSnapshot = snapshot || buildSnapshot(checkpoint);

      if (aiSnapshot) {
        try {
          directive = await getColonyDirective(aiSnapshot);

          // Store directive and timestamp
          await Promise.all([
            kv.set('colony:directive', directive, { ex: 86400 }),
            kv.set('colony:last-ai-call', now, { ex: 86400 }),
          ]);
        } catch (aiError) {
          console.error('Claude AI call failed:', aiError);
          // Don't fail the save just because AI failed
        }
      }
    }

    return res.status(200).json({
      ok: true,
      directive: directive || null,
      savedAt: now,
    });
  } catch (error) {
    console.error('Error saving checkpoint:', error);
    return res.status(500).json({ error: 'Failed to save checkpoint' });
  }
}

// Build a compact snapshot for Claude from the checkpoint data
function buildSnapshot(checkpoint: any) {
  if (!checkpoint || !checkpoint.ants) return null;

  const roles = { digger: 0, forager: 0, explorer: 0, nurse: 0, idle: 0 };
  let avgEnergy = 0;
  let stuckCount = 0;
  let workerCount = 0;

  for (const ant of checkpoint.ants) {
    if (ant.isQueen) continue;
    workerCount++;
    const r = ant.role || 'idle';
    if (r in roles) (roles as any)[r]++;
    else roles.idle++;
    avgEnergy += ant.energy || 0;
    if ((ant.stuck || 0) > 3) stuckCount++;
  }

  avgEnergy = workerCount > 0 ? Math.round(avgEnergy / workerCount) : 0;

  // Brood counts
  const brood = checkpoint.brood || [];
  const broodCounts = { eggs: 0, larvae: 0, pupae: 0 };
  for (const b of brood) {
    if (b.stage === 0) broodCounts.eggs++;
    else if (b.stage === 1) broodCounts.larvae++;
    else if (b.stage === 2) broodCounts.pupae++;
  }

  // Chamber types
  const chamberTypes: Record<string, number> = {};
  for (const c of (checkpoint.chambers || [])) {
    const t = c.type || 'general';
    chamberTypes[t] = (chamberTypes[t] || 0) + 1;
  }

  return {
    day: checkpoint.simDay || 1,
    pop: workerCount,
    dug: checkpoint.totalDug ? ((checkpoint.totalDug / ((227 - 61) * 320)) * 100).toFixed(1) + '%' : '0%',
    roles,
    food: (checkpoint.foods || []).reduce((s: number, f: any) => s + (f.amount || 0), 0),
    storedFood: (checkpoint.foodStores || []).reduce((s: number, f: any) => s + (f.amount || 0), 0),
    brood: broodCounts,
    chambers: (checkpoint.chambers || []).length,
    chamberTypes,
    queenUnderground: checkpoint.queenUnderground || false,
    avgEnergy,
    stuck: stuckCount,
  };
}
