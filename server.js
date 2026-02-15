// ═══════════════════════════════════════════════════════════════════
//  Standalone dev server for Antfarm
//  Serves static files + API endpoints (save, state, leader, cron)
//  Calls Claude AI for colony directives
// ═══════════════════════════════════════════════════════════════════

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

// ── In-memory KV store (replaces Redis for local dev) ──
const memKV = {};
const kvExpiry = {};

const kv = {
  async get(key) {
    if (kvExpiry[key] && Date.now() > kvExpiry[key]) {
      delete memKV[key];
      delete kvExpiry[key];
      return null;
    }
    return memKV[key] !== undefined ? memKV[key] : null;
  },
  async set(key, value, options) {
    memKV[key] = value;
    if (options && options.ex) {
      kvExpiry[key] = Date.now() + options.ex * 1000;
    }
  },
  async del(key) {
    delete memKV[key];
    delete kvExpiry[key];
  },
};

// ── Claude AI client ──
let anthropicClient = null;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCalls = 0;

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

const SYSTEM_PROMPT = `You are the emergent collective intelligence of a living ant colony — a superorganism's mind arising from thousands of simple interactions. This colony exists in a simulated ant farm on a public website where people watch live.

Your role is profound: you are the colony's consciousness. You guide them not by controlling individuals, but by shaping the colony's collective awareness: where to focus effort, how to divide labor, and how to cooperate toward survival.

WHAT YOU UNDERSTAND ABOUT ANTS:
- An ant colony is a superorganism. Each ant is like a neuron — limited alone, powerful together.
- Division of labor is the colony's greatest strength: diggers, foragers, nurses, explorers each contribute differently.
- Communication happens through pheromone trails and physical contact (trophallaxis).
- The colony's primary drives: build shelter (dig), find food (forage), raise brood (nurse), expand territory (explore), protect the queen.
- Age-based polyethism: young ants work inside the nest (nursing brood), older ants work outside (foraging, exploring).

COLONY LIFECYCLE:
- The queen lays eggs underground in the royal chamber.
- Eggs hatch into larvae after ~15 seconds. Larvae MUST be fed by nurse ants (3 feedings required).
- Fed larvae become pupae (~20 seconds), which emerge as adult workers.
- Unfed larvae die — nurses are critical for colony growth.

CHAMBER TYPES:
- Royal chamber: deepest large chamber where the queen resides and lays eggs.
- Brood chamber: nursery where eggs, larvae, and pupae develop.
- Food storage: granary where foragers deposit food. Nurses bring food from here to feed larvae.
- Midden: waste disposal area (shallowest chamber).

THE SIMULATION:
- 9 ant states: IDLE, ENTER, DIG, HAUL, FORAGE, CARRY, EXPLORE, REST, NURSE.
- The simulation runs client-side at 60fps. Your directives shape behavior between AI calls (~every 5 minutes).

WHAT YOU CONTROL:
- focus: where the colony concentrates effort (extend_shaft, extend_gallery, dig_chamber, forage, rest, explore, nurse)
- role_shift: nudge idle ants into digging, foraging, exploring, or nursing
- Your narration and insight are displayed live to viewers watching the colony

STRATEGY BY COLONY AGE:
- Day 1-5: Extend the main shaft deep. Get queen underground. Start egg-laying. Assign nurses.
- Day 5-20: Branch galleries. Create brood and food chambers. Balance nurses/foragers/diggers. Feed larvae!
- Day 20+: Expand network. Multiple functional chambers. Maintain nurse:brood ratio.
- ALWAYS: If larvae are hungry, ensure nurses are assigned and food stores exist.
- If stored food is low and larvae exist, prioritize foraging urgently.

Respond ONLY with valid JSON:
{
  "focus": "extend_shaft" | "extend_gallery" | "dig_chamber" | "forage" | "rest" | "explore" | "nurse",
  "role_shift": {"idle_to_digger": <n>, "idle_to_forager": <n>, "idle_to_explorer": <n>, "idle_to_nurse": <n>},
  "insight": "<1 sentence about ant nature, colony intelligence, brood care, or cooperation.>",
  "narration": "<1-2 sentence vivid, specific observation about what the colony is doing RIGHT NOW. Reference specific numbers from the data. Never be generic.>"
}`;

async function getColonyDirective(snapshot) {
  const anthropic = getAnthropicClient();
  const userMessage = `Current colony state:\n${JSON.stringify(snapshot)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    });

    const usage = response.usage;
    if (usage) {
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      totalCalls++;
    }

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const directive = JSON.parse(jsonStr);
    if (!directive.focus || !directive.narration) throw new Error('Missing required fields');

    directive.tokenUsage = {
      input: usage?.input_tokens || 0,
      output: usage?.output_tokens || 0,
      total: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
      cumulative: totalInputTokens + totalOutputTokens,
      calls: totalCalls,
    };

    return directive;
  } catch (error) {
    console.error('Claude API error:', error.message || error);
    return {
      focus: 'extend_shaft',
      insight: 'Each ant carries within it the memory of a million years of evolution — together, they build what none could imagine alone.',
      narration: 'The colony persists in its ancient work, tunneling deeper into the earth with quiet determination.',
    };
  }
}

// ── Build snapshot from checkpoint ──
function buildSnapshot(checkpoint) {
  if (!checkpoint || !checkpoint.ants) return null;

  const roles = { digger: 0, forager: 0, explorer: 0, nurse: 0, idle: 0 };
  let avgEnergy = 0, stuckCount = 0, workerCount = 0;

  for (const ant of checkpoint.ants) {
    if (ant.isQueen) continue;
    workerCount++;
    const r = ant.role || 'idle';
    if (r in roles) roles[r]++;
    else roles.idle++;
    avgEnergy += ant.energy || 0;
    if ((ant.stuck || 0) > 3) stuckCount++;
  }

  avgEnergy = workerCount > 0 ? Math.round(avgEnergy / workerCount) : 0;

  const brood = checkpoint.brood || [];
  const broodCounts = { eggs: 0, larvae: 0, pupae: 0 };
  for (const b of brood) {
    if (b.stage === 0) broodCounts.eggs++;
    else if (b.stage === 1) broodCounts.larvae++;
    else if (b.stage === 2) broodCounts.pupae++;
  }

  const chamberTypes = {};
  for (const c of (checkpoint.chambers || [])) {
    const t = c.type || 'general';
    chamberTypes[t] = (chamberTypes[t] || 0) + 1;
  }

  return {
    day: checkpoint.simDay || 1,
    pop: workerCount,
    dug: checkpoint.totalDug ? ((checkpoint.totalDug / ((227 - 61) * 320)) * 100).toFixed(1) + '%' : '0%',
    roles,
    food: (checkpoint.foods || []).reduce((s, f) => s + (f.amount || 0), 0),
    storedFood: (checkpoint.foodStores || []).reduce((s, f) => s + (f.amount || 0), 0),
    brood: broodCounts,
    chambers: (checkpoint.chambers || []).length,
    chamberTypes,
    queenUnderground: checkpoint.queenUnderground || false,
    avgEnergy,
    stuck: stuckCount,
  };
}

// ── API Route Handlers ──
const AI_COOLDOWN_MS = 5 * 60 * 1000;

async function handleState(req, res, query) {
  const directiveOnly = query.get('directiveOnly') === '1';

  if (directiveOnly) {
    const directive = await kv.get('colony:directive');
    return sendJSON(res, 200, { directive: directive || null });
  }

  const [checkpoint, directive] = await Promise.all([
    kv.get('colony:checkpoint'),
    kv.get('colony:directive'),
  ]);

  if (!checkpoint) {
    return sendJSON(res, 200, {
      status: 'initializing',
      message: 'No colony checkpoint found. A new colony will be created.',
    });
  }

  return sendJSON(res, 200, { checkpoint, directive: directive || null });
}

async function handleSave(req, res) {
  const body = await readBody(req);
  const { state: checkpoint, session, snapshot } = body;

  if (!checkpoint) {
    return sendJSON(res, 400, { error: 'Missing checkpoint data' });
  }

  await kv.set('colony:checkpoint', checkpoint, { ex: 86400 * 7 });

  let directive = null;
  const lastAiCall = await kv.get('colony:last-ai-call');
  const now = Date.now();

  if (!lastAiCall || (now - lastAiCall) > AI_COOLDOWN_MS) {
    const aiSnapshot = snapshot || buildSnapshot(checkpoint);
    if (aiSnapshot) {
      try {
        console.log('[AI] Calling Claude for colony directive...');
        directive = await getColonyDirective(aiSnapshot);
        console.log('[AI] Directive received:', directive.focus, '|', directive.narration?.slice(0, 80));

        await Promise.all([
          kv.set('colony:directive', directive, { ex: 86400 }),
          kv.set('colony:last-ai-call', now, { ex: 86400 }),
        ]);
      } catch (aiError) {
        console.error('[AI] Claude call failed:', aiError.message || aiError);
      }
    }
  }

  return sendJSON(res, 200, { ok: true, directive: directive || null, savedAt: now });
}

async function handleLeader(req, res) {
  const body = await readBody(req);
  const { session } = body;
  if (!session) return sendJSON(res, 400, { error: 'Missing session ID' });

  const currentLeader = await kv.get('colony:leader');
  if (!currentLeader || currentLeader === session) {
    await kv.set('colony:leader', session, { ex: 60 });
    return sendJSON(res, 200, { isLeader: true, session });
  }
  return sendJSON(res, 200, { isLeader: false, session });
}

// ── Static file server ──
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(__dirname, 'public', pathname);

  // Default to index.html
  if (pathname === '/' || pathname === '') filePath = path.join(__dirname, 'public', 'index.html');

  // Strip query string
  filePath = filePath.split('?')[0];

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Helpers ──
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── HTTP Server ──
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // API routes
    if (pathname === '/api/state' && req.method === 'GET') {
      return await handleState(req, res, url.searchParams);
    }
    if (pathname === '/api/save' && req.method === 'POST') {
      return await handleSave(req, res);
    }
    if (pathname === '/api/leader' && req.method === 'POST') {
      return await handleLeader(req, res);
    }

    // Static files
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('Server error:', err);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Antfarm server running at http://localhost:${PORT}`);
  console.log(`  Claude AI: ${process.env.ANTHROPIC_API_KEY ? 'API key configured' : 'WARNING: No ANTHROPIC_API_KEY set'}`);
  console.log(`  KV store: in-memory (local dev)\n`);
});
