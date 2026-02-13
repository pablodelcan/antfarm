// ═══════════════════════════════════════════════════════════════════
//  /api/tick — Cron endpoint that runs every 5 minutes
//  1. Loads colony state from KV
//  2. Runs 18,000 simulation ticks (5 min at 60fps)
//  3. Calls Claude Haiku for colony directive
//  4. Applies directive
//  5. Saves updated state
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { getColonyDirective, applyDirective } from '../lib/claude';
import type { ColonyDirective } from '../lib/types';

// Dynamic import for the JS simulation engine
let sim: any = null;
async function getSim() {
  if (!sim) {
    sim = require('../lib/simulation');
  }
  return sim;
}

// How many ticks to simulate per 5-minute cron interval
// 60fps × 60s × 5min = 18,000 ticks
const TICKS_PER_INTERVAL = 18_000;

// Maximum function execution time safety margin
const MAX_EXECUTION_MS = 55_000; // 55s (Vercel Pro limit is 60s)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();

  // Verify this is a cron call or has authorization
  // Vercel crons include an Authorization header
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManualTrigger = req.query.secret === process.env.CRON_SECRET;

  if (!isVercelCron && !isManualTrigger && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const simulation = await getSim();

    // 1. Load colony state from KV
    let state: any;
    const serializedState = await kv.get('colony:state');

    if (serializedState) {
      state = simulation.deserializeState(serializedState);
      console.log(`Loaded colony: Day ${state.simDay}, ${state.ants.length} ants, ${state.totalDug} dug`);
    } else {
      // First time — create new colony
      state = simulation.createColony();
      console.log('Created new colony');
    }

    // 2. Run simulation ticks
    const tickStart = Date.now();
    let ticksRun = 0;
    const batchSize = 1000; // Run in batches to check time

    while (ticksRun < TICKS_PER_INTERVAL) {
      const remaining = TICKS_PER_INTERVAL - ticksRun;
      const batch = Math.min(batchSize, remaining);
      state = simulation.tickColony(state, batch);
      ticksRun += batch;

      // Safety: don't exceed execution time limit
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.warn(`Time limit approaching, ran ${ticksRun}/${TICKS_PER_INTERVAL} ticks`);
        break;
      }
    }

    const tickTime = Date.now() - tickStart;
    console.log(`Simulated ${ticksRun} ticks in ${tickTime}ms`);

    // 3. Get colony snapshot for Claude
    const snapshot = simulation.getColonySnapshot(state);

    // 4. Call Claude for directive
    let directive: ColonyDirective | null = null;
    try {
      directive = await getColonyDirective(snapshot);
      console.log(`Claude directive: focus=${directive.focus}, narration="${directive.narration.slice(0, 60)}..."`);
    } catch (claudeError) {
      console.error('Claude API error (will use fallback):', claudeError);
      directive = {
        focus: 'extend_shaft' as const,
        narration: 'The colony persists in its ancient work, tunneling deeper into the earth with quiet determination.',
        priority_override: { shaft: 7, gallery: 5, chamber: 3 },
      };
    }

    // 5. Apply directive
    applyDirective(state, directive);

    // 6. Save state to KV
    const serialized = simulation.serializeState(state);
    const viewerState = simulation.getViewerState(state);

    // Save both full state (for next tick) and viewer state (for clients)
    await Promise.all([
      kv.set('colony:state', serialized),
      kv.set('colony:viewer-state', viewerState),
      kv.set('colony:directive', directive),
      kv.set('colony:last-tick', Date.now()),
    ]);

    const totalTime = Date.now() - startTime;
    console.log(`Tick complete in ${totalTime}ms. Day ${state.simDay}, ${state.ants.length} ants.`);

    return res.status(200).json({
      success: true,
      ticksRun,
      tickTimeMs: tickTime,
      totalTimeMs: totalTime,
      day: state.simDay,
      ants: state.ants.length,
      directive: directive.focus,
      narration: directive.narration,
    });
  } catch (error) {
    console.error('Tick error:', error);
    return res.status(500).json({
      error: 'Tick failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
