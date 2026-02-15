// ═══════════════════════════════════════════════════════════════════
//  GET /api/cron — Hourly AI evolution cron job
//  Called by Vercel Cron every hour.
//  Claude reviews the colony snapshot and produces tuning parameters
//  that adjust ant behavior for the next hour.
//  Uses Haiku for minimal token cost (~$0.01/call).
// ═══════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
const { kv } = require('../lib/kv');
import Anthropic from '@anthropic-ai/sdk';

const EVOLUTION_SYSTEM_PROMPT = `You are the evolutionary intelligence of a living ant colony simulation. Every hour, you review the colony's state and produce behavioral tuning parameters that will shape how the ants operate for the next hour.

You are NOT controlling individual ants. You are adjusting the colony's behavioral constants — like a geneticist fine-tuning instincts over generations.

THE PARAMETERS YOU CAN TUNE (with their current defaults):
- digPriority (1-10): How aggressively ants dig. Higher = more digging. Default: 7
- restThreshold (0-100): Energy level below which ants rest. Default: 20
- explorationBias (0-1): Chance idle ants choose to explore vs dig. Default: 0.3
- forageRadius (50-400): How far ants search for food on the surface. Default: 200
- branchingChance (0-1): Probability of creating a new gallery branch while digging. Default: 0.15
- chamberSizeTarget (40-200): Target size in cells for carved chambers. Default: 60
- antMaxEnergy (50-200): Maximum energy capacity per ant. Default: 100
- queenSpawnRate (600-5400): Frames between queen laying eggs. Default: 1800
- sandCarryMax (1-10): Max sand grains an ant can carry before hauling. Default: 5
- nursePriority (1-10): How aggressively young ants are recruited to nurse brood. Default: 5
- focus: The colony's primary strategic focus (extend_shaft, extend_gallery, dig_chamber, forage, rest, explore, nurse)
- role_shift: How many idle ants to redirect (idle_to_digger, idle_to_forager, idle_to_explorer, idle_to_nurse)

COLONY LIFECYCLE (REALISTIC):
- The queen lays eggs underground. Eggs hatch into larvae that MUST be fed by nurse ants.
- Fed larvae become pupae, which emerge as adult workers. Unfed larvae die.
- Young workers naturally become nurses; older workers forage and explore (age-based polyethism).
- Food must be foraged, stored in food chambers, and carried by nurses to feed larvae.
- Functional chambers: royal (queen), brood (nursery), food (granary), midden (waste).

STRATEGY GUIDELINES:
- Early colony (day 1-5): Prioritize shaft depth, high dig priority, get queen underground, start brood care
- Growth (day 5-20): Balance digging with foraging, increase branching, create chambers, ensure nurse coverage
- Mature (day 20+): High exploration, diverse chambers, aggressive foraging, maintain healthy brood pipeline
- If larvae are hungry: increase nursePriority, ensure foragers feed stores, shift idle to nurse
- If many ants are stuck: reduce dig priority, increase exploration bias
- If energy is low: increase foraging, raise rest threshold
- If food stores are empty and larvae exist: URGENT — shift to foraging
- ALWAYS provide a brief narration and insight for viewers

Respond ONLY with valid JSON:
{
  "tuning": {
    "digPriority": <number>,
    "restThreshold": <number>,
    "explorationBias": <number>,
    "forageRadius": <number>,
    "branchingChance": <number>,
    "chamberSizeTarget": <number>,
    "antMaxEnergy": <number>,
    "queenSpawnRate": <number>,
    "sandCarryMax": <number>,
    "nursePriority": <number>
  },
  "focus": "<strategic focus>",
  "role_shift": {"idle_to_digger": <n>, "idle_to_forager": <n>, "idle_to_explorer": <n>, "idle_to_nurse": <n>},
  "insight": "<1 sentence — poetic or scientific observation about ant colony intelligence, brood care, or cooperation>",
  "narration": "<1-2 sentences — vivid observation of the colony's current state, reference specific data>"
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get the latest checkpoint snapshot
    const checkpoint = await kv.get('colony:checkpoint');
    if (!checkpoint) {
      return res.status(200).json({ ok: true, message: 'No colony data yet' });
    }

    // Build a compact snapshot for the AI
    const snapshot = buildEvolutionSnapshot(checkpoint);
    if (!snapshot) {
      return res.status(200).json({ ok: true, message: 'Could not build snapshot' });
    }

    // Get previous tuning for context
    const prevTuning = await kv.get('colony:tuning');

    // Call Claude Haiku
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const userMessage = `Colony state (hourly review):\n${JSON.stringify(snapshot)}\n\n${prevTuning ? 'Previous tuning parameters:\n' + JSON.stringify(prevTuning) : 'No previous tuning — this is the first hourly review.'}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: [
        {
          type: 'text',
          text: EVOLUTION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        { role: 'user', content: userMessage }
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const evolution = JSON.parse(jsonStr);

    // Track token usage
    const usage = response.usage;
    const tokenInfo = {
      input: usage?.input_tokens || 0,
      output: usage?.output_tokens || 0,
      total: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
      timestamp: Date.now(),
    };

    // Store tuning parameters (24h TTL)
    await kv.set('colony:tuning', evolution.tuning || {}, { ex: 86400 });

    // Store as a directive so clients pick it up
    const directive = {
      focus: evolution.focus || 'extend_shaft',
      role_shift: evolution.role_shift || {},
      insight: evolution.insight || '',
      narration: evolution.narration || '',
      tuning: evolution.tuning || {},
      tokenUsage: tokenInfo,
      source: 'cron',
      timestamp: Date.now(),
    };

    await kv.set('colony:directive', directive, { ex: 86400 });

    // Store evolution history (keep last 24 entries = 24 hours)
    const history = (await kv.get('colony:evolution-history')) || [];
    history.push({
      timestamp: Date.now(),
      snapshot,
      directive: { focus: directive.focus, tuning: directive.tuning },
      tokens: tokenInfo.total,
    });
    // Keep only last 24 entries
    while (history.length > 24) history.shift();
    await kv.set('colony:evolution-history', history, { ex: 86400 * 7 });

    return res.status(200).json({
      ok: true,
      directive,
      tokens: tokenInfo,
    });
  } catch (error) {
    console.error('Cron evolution error:', error);
    return res.status(500).json({ error: 'Evolution cron failed', details: String(error) });
  }
}

function buildEvolutionSnapshot(checkpoint: any) {
  if (!checkpoint || !checkpoint.ants) return null;

  const roles = { digger: 0, forager: 0, explorer: 0, nurse: 0, idle: 0 };
  let avgEnergy = 0, stuckCount = 0, workerCount = 0;
  let minEnergy = Infinity, maxEnergy = 0;

  for (const ant of checkpoint.ants) {
    if (ant.isQueen) continue;
    workerCount++;
    const r = ant.role || 'idle';
    if (r in roles) (roles as any)[r]++;
    else roles.idle++;
    avgEnergy += ant.energy || 0;
    if ((ant.stuck || 0) > 3) stuckCount++;
    if (ant.energy < minEnergy) minEnergy = ant.energy;
    if (ant.energy > maxEnergy) maxEnergy = ant.energy;
  }

  avgEnergy = workerCount > 0 ? Math.round(avgEnergy / workerCount) : 0;

  const totalCells = (227 - 61) * 320;
  const dugPct = checkpoint.totalDug ? ((checkpoint.totalDug / totalCells) * 100).toFixed(1) : '0';

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
    frame: checkpoint.frame || 0,
    pop: workerCount,
    hasQueen: checkpoint.hasQueen || false,
    queenUnderground: checkpoint.queenUnderground || false,
    dug: dugPct + '%',
    roles,
    food: (checkpoint.foods || []).reduce((s: number, f: any) => s + (f.amount || 0), 0),
    storedFood: (checkpoint.foodStores || []).reduce((s: number, f: any) => s + (f.amount || 0), 0),
    foodSources: (checkpoint.foods || []).length,
    brood: broodCounts,
    chambers: (checkpoint.chambers || []).length,
    chamberTypes,
    avgEnergy,
    minEnergy: minEnergy === Infinity ? 0 : Math.round(minEnergy),
    maxEnergy: Math.round(maxEnergy),
    stuck: stuckCount,
    digPriority: checkpoint.digPriority || 7,
  };
}
