// ═══════════════════════════════════════════════════════════════════
//  /api/tick — Cron endpoint that runs every 5 minutes
//  1. Loads colony state from KV
//  2. Runs 18,000 simulation ticks (5 min at 60fps)
//  3. Calls Claude Haiku for colony directive
//  4. Applies directive
//  5. Saves updated state
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');
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

  // Verify this is a cron call, has authorization, or is a viewer-triggered tick
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManualTrigger = req.query.secret === process.env.CRON_SECRET;
  const isViewerTrigger = req.query.viewer === '1';

  // On Hobby plan, cron is daily only, so viewers can trigger ticks too
  // Rate-limit viewer triggers via KV timestamp check
  if (!isVercelCron && !isManualTrigger && !isViewerTrigger && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Handle colony reset request (wipe state, next tick creates fresh colony)
  const isReset = req.query.reset === '1';
  if (isReset) {
    try {
      // Rate-limit resets to once per 2 minutes
      const lastReset = await kv.get('colony:last-reset') as number | null;
      if (lastReset && Date.now() - lastReset < 2 * 60 * 1000) {
        return res.status(200).json({ throttled: true, message: 'Reset ran recently, wait a bit' });
      }
      await Promise.all([
        kv.del('colony:state'),
        kv.del('colony:viewer-state'),
        kv.del('colony:directive'),
        kv.set('colony:last-reset', Date.now()),
      ]);
      console.log('Colony reset — will create fresh on next tick');
      // Fall through to run a tick with fresh state
    } catch (resetErr) {
      console.error('Reset error:', resetErr);
    }
  }

  // Rate-limit viewer-triggered ticks to once per 4 minutes
  if (isViewerTrigger && !isReset) {
    const lastTick = await kv.get('colony:last-tick') as number | null;
    if (lastTick && Date.now() - lastTick < 4 * 60 * 1000) {
      return res.status(200).json({ throttled: true, message: 'Tick ran recently' });
    }
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

    // 1b. Process admin commands from KV queue
    try {
      const adminCommands = (await kv.get('colony:admin-commands')) as any[] | null;
      if (adminCommands && adminCommands.length > 0) {
        for (const cmd of adminCommands) {
          switch (cmd.action) {
            case 'addAnts':
              simulation.dropAnts(state, 5);
              console.log('Admin: Added 5 ants');
              break;
            case 'dropFood':
              simulation.dropFood(state);
              console.log('Admin: Dropped food');
              break;
            case 'togglePause':
              // Pause/unpause all ants
              for (const ant of state.ants) {
                ant.isPaused = !ant.isPaused;
              }
              console.log('Admin: Toggled pause');
              break;
            case 'setSpeed':
              // Speed multiplier affects ticks per interval
              // Stored but not changing tick count (would need different approach)
              console.log('Admin: Speed set to ' + cmd.value);
              break;
            case 'resetColony':
              // Wipe state — will be recreated fresh below
              await kv.del('colony:state');
              await kv.del('colony:viewer-state');
              await kv.del('colony:directive');
              state = simulation.createColony();
              console.log('Admin: Colony reset to fresh state');
              break;
          }
        }
        // Clear processed commands
        await kv.del('colony:admin-commands');
      }
    } catch (adminError) {
      console.error('Admin command processing error:', adminError);
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
