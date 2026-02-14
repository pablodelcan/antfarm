// =====================================================================
//  ANTFARM Headless Simulation Engine
//  CommonJS module — works in Node.js without any browser APIs
//
//  Extracted from index.html v7 — all simulation logic, no rendering.
//
//  Exports:
//    createColony()          - initialize fresh colony, returns state
//    tickColony(state, n)    - run N simulation ticks, returns state
//    serializeState(state)   - convert state to JSON-safe object
//    deserializeState(data)  - reconstruct state from serialized data
//    getColonySnapshot(state)- compact summary for Claude API
//    applyDirective(state, d)- apply Claude's strategic directive
//    getViewerState(state)   - full state for browser viewer
// =====================================================================

'use strict';

// =====================================================================
//  CONSTANTS
// =====================================================================

const W = 960, H = 680;
const CELL = 3;
const COLS = W / CELL, ROWS = Math.ceil(H / CELL);
const SURFACE = Math.round(ROWS * 0.27);
const SURFACE_PX = SURFACE * CELL;
const FRAME = 14;

const PX_PER_CM = 24;
const ANT_BODY_PX = 14;

const BASE_SPEED = 0.8;
const LOADED_SPEED = 0.45;
const TANDEM_SPEED = 0.2;

const AI_INTERVAL = 600;

const SAND_R = 212, SAND_G = 194, SAND_B = 162;

// =====================================================================
//  STATE ENUMS
// =====================================================================

const ST = {
  WANDER: 0, ENTER: 1, DIG_DOWN: 2, DIG_BRANCH: 3, DIG_CHAMBER: 4,
  EXPLORE: 5, GO_UP: 6, FORAGE: 7, CARRY: 8, REST: 9, WALL_FOLLOW: 10,
  HAUL_SAND: 11, TANDEM_LEAD: 12, TANDEM_FOLLOW: 13, ANTENNATE: 14, PAUSE: 15,
  DIG_TO_TARGET: 16
};

const ST_NAMES = [
  'Wandering', 'Entering', 'Digging down', 'Branching', 'Carving chamber',
  'Exploring', 'Returning', 'Foraging', 'Carrying food', 'Resting', 'Wall following',
  'Hauling sand', 'Leading', 'Following', 'Communicating', 'Pausing', 'Navigating to dig site'
];

// =====================================================================
//  NOISE — smooth terrain generation
// =====================================================================

function smoothNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hashN(ix, iy, seed);
  const n10 = hashN(ix + 1, iy, seed);
  const n01 = hashN(ix, iy + 1, seed);
  const n11 = hashN(ix + 1, iy + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hashN(x, y, s) {
  let n = Math.sin(x * 127.1 + y * 311.7 + s * 73.3) * 43758.5453;
  return n - Math.floor(n);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function fbm(x, y) {
  return smoothNoise(x, y, 0) * 0.5
       + smoothNoise(x * 2.1, y * 2.3, 1) * 0.25
       + smoothNoise(x * 4.7, y * 4.1, 2) * 0.125
       + smoothNoise(x * 9.3, y * 8.7, 3) * 0.0625;
}

function genSandNoise() {
  const sandNoise = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const n1 = smoothNoise(px * 0.02, py * 0.02, 10) * 0.5;
      const n2 = smoothNoise(px * 0.05, py * 0.05, 20) * 0.25;
      const n3 = smoothNoise(px * 0.12, py * 0.12, 30) * 0.125;
      const n4 = smoothNoise(px * 0.3, py * 0.3, 40) * 0.0625;
      sandNoise[py * W + px] = (n1 + n2 + n3 + n4 - 0.45) * 2;
    }
  }
  return sandNoise;
}
// Alias for deserialization
const genSandNoiseArray = genSandNoise;

// =====================================================================
//  TERRAIN
// =====================================================================

function initTerrain(state) {
  state.grid = new Uint8Array(COLS * ROWS);
  state.phTrail = new Float32Array(COLS * ROWS);
  state.phFood = new Float32Array(COLS * ROWS);
  state.phDig = new Float32Array(COLS * ROWS);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (y < SURFACE) { state.grid[y * COLS + x] = 0; continue; }
      const d = (y - SURFACE) / (ROWS - SURFACE);
      const n = fbm(x * 0.04, y * 0.04) - 0.4;
      state.grid[y * COLS + x] = Math.max(1, Math.min(4, Math.round(1 + d * 2.5 + n * 1.0)));
    }
  }
  // Rocks
  for (let k = 0; k < 4; k++) {
    const cx = (Math.random() * (COLS - 14) + 7) | 0;
    const cy = (Math.random() * (ROWS - SURFACE - 20) + SURFACE + 14) | 0;
    const r = 2 + (Math.random() * 3) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < COLS && ny >= SURFACE && ny < ROWS) state.grid[ny * COLS + nx] = 5;
      }
    }
  }
  state.terrainDirty = true;
}

function cellAt(state, x, y) {
  return (x < 0 || x >= COLS || y < 0 || y >= ROWS) ? 255 : state.grid[y * COLS + x];
}

function isSolid(state, x, y) {
  return cellAt(state, x, y) > 0;
}

function digCell(state, x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 0;
  const i = y * COLS + x;
  if (!state.grid[i]) return 0;
  if (state.grid[i] <= 1) {
    state.grid[i] = 0; state.totalDug++; state.terrainDirty = true;
    // Harden adjacent walls to prevent gravity collapse (anti-V-shape)
    reinforceWalls(state, x, y);
    return 1;
  }
  state.grid[i]--; state.terrainDirty = true; return 1;
}

// Harden cells adjacent to a newly dug tunnel cell so gravity doesn't
// slide loose sand into the tunnel, preventing V-shaped erosion.
// Hardens a 2-cell-wide wall on each side, and up to 2 rows above.
function reinforceWalls(state, x, y) {
  for (const dx of [-1, -2, 1, 2]) {
    for (let dy = -2; dy <= 0; dy++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const ni = ny * COLS + nx;
      const v = state.grid[ni];
      if (v > 0 && v < 3) {
        state.grid[ni] = 3;
      }
    }
  }
}

function depositSandOnSurface(state, gx) {
  let depositY = SURFACE;
  for (let y = Math.max(0, SURFACE - 10); y < Math.min(ROWS, SURFACE + 5); y++) {
    if (isSolid(state, gx, y)) { depositY = y - 1; break; }
  }
  if (depositY < 2) return;
  let nx = gx;
  if (Math.random() > 0.82) {
    nx += Math.random() < 0.5 ? -1 : 1;
    nx = Math.max(1, Math.min(COLS - 2, nx));
  }
  if (depositY >= 0 && depositY < ROWS && !isSolid(state, nx, depositY)) {
    state.grid[depositY * COLS + nx] = 1;
    state.terrainDirty = true;
  }
}

function gravity(state) {
  for (let y = ROWS - 2; y >= SURFACE; y--) {
    for (let x = 0; x < COLS; x++) {
      const v = state.grid[y * COLS + x];
      if (!v || v > 2) continue;
      if (!cellAt(state, x, y + 1)) {
        state.grid[(y + 1) * COLS + x] = v; state.grid[y * COLS + x] = 0; state.terrainDirty = true;
      } else {
        const cl = !cellAt(state, x - 1, y + 1) && !cellAt(state, x - 1, y);
        const cr = !cellAt(state, x + 1, y + 1) && !cellAt(state, x + 1, y);
        if (cl && cr) {
          const d = Math.random() < 0.5 ? -1 : 1;
          state.grid[(y + 1) * COLS + (x + d)] = v; state.grid[y * COLS + x] = 0; state.terrainDirty = true;
        } else if (cl) {
          state.grid[(y + 1) * COLS + (x - 1)] = v; state.grid[y * COLS + x] = 0; state.terrainDirty = true;
        } else if (cr) {
          state.grid[(y + 1) * COLS + (x + 1)] = v; state.grid[y * COLS + x] = 0; state.terrainDirty = true;
        }
      }
    }
  }
}

// =====================================================================
//  PHEROMONES
// =====================================================================

function phSet(state, x, y, v, mapName) {
  const m = state[mapName];
  if (x >= 0 && x < COLS && y >= 0 && y < ROWS) m[y * COLS + x] = Math.min(1.5, m[y * COLS + x] + v);
}

function phGet(state, x, y, mapName) {
  const m = state[mapName];
  return (x >= 0 && x < COLS && y >= 0 && y < ROWS) ? m[y * COLS + x] : 0;
}

function phDecay(state) {
  for (let i = 0; i < state.phTrail.length; i++) {
    state.phTrail[i] *= 0.993; state.phFood[i] *= 0.996; state.phDig[i] *= 0.99;
    if (state.phTrail[i] < 0.003) state.phTrail[i] = 0;
    if (state.phFood[i] < 0.003) state.phFood[i] = 0;
    if (state.phDig[i] < 0.003) state.phDig[i] = 0;
  }
}

function phGradient(state, gx, gy, mapName, radius) {
  let bestVal = phGet(state, gx, gy, mapName);
  let bestAngle = null;
  const r = radius || 5;
  for (let a = 0; a < 6.28; a += 0.524) {
    const cx = gx + Math.round(Math.cos(a) * r);
    const cy = gy + Math.round(Math.sin(a) * r);
    const v = phGet(state, cx, cy, mapName);
    if (v > bestVal + 0.01) { bestVal = v; bestAngle = a; }
  }
  return { angle: bestAngle, strength: bestVal };
}

// =====================================================================
//  CHAMBERS
// =====================================================================

function detectChambers(state) {
  state.chambers = [];
  const vis = new Uint8Array(COLS * ROWS);
  for (let y = SURFACE + 5; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      if (!state.grid[i] && !vis[i]) {
        let n = 0, sx = 0, sy = 0;
        const q = [[x, y]]; vis[i] = 1;
        while (q.length && n < 1200) {
          const [cx, cy] = q.pop(); n++; sx += cx; sy += cy;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < COLS && ny >= SURFACE && ny < ROWS) {
              const ni = ny * COLS + nx;
              if (!state.grid[ni] && !vis[ni]) { vis[ni] = 1; q.push([nx, ny]); }
            }
          }
        }
        if (n >= 40) state.chambers.push({ x: (sx / n) * CELL, y: (sy / n) * CELL, size: n });
      }
    }
  }
}

// =====================================================================
//  TUNNEL PLAN — shared colony intelligence for structured tunnels
// =====================================================================

function createTunnelPlan() {
  return {
    entrances: [],
    mainShaftX: -1,
    mainShaftX2: -1,
    galleries: [],
    digFrontier: [],
    shaftBottom: 0,
    shaftBottom2: 0,
    initialized: false
  };
}

function tunnelPlanInit(tp) {
  tp.mainShaftX = Math.round(COLS * 0.45 + Math.random() * COLS * 0.1);
  tp.mainShaftX2 = -1;
  tp.entrances = [{ gx: tp.mainShaftX, depth: 0 }];
  tp.galleries = [];
  tp.shaftBottom = SURFACE + 2;
  tp.shaftBottom2 = SURFACE;
  tp.initialized = true;
  tunnelPlanUpdateFrontier(tp, null);
}

function tunnelPlanNearestEntrance(tp, gx) {
  if (tp.entrances.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const e of tp.entrances) {
    const d = Math.abs(e.gx - gx);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best;
}

function tunnelPlanGetDigAssignment(tp, antGx, antGy, ants) {
  if (tp.digFrontier.length === 0) tunnelPlanUpdateFrontier(tp, ants);

  let best = null, bestScore = -Infinity;
  for (const f of tp.digFrontier) {
    const dist = Math.hypot(f.gx - antGx, f.gy - antGy);
    let crowding = 0;
    if (ants) {
      for (const a of ants) {
        if (a.role === 'digger' && Math.hypot(a._gx() - f.gx, a._gy() - f.gy) < 8) crowding++;
      }
    }
    const score = f.priority * 3 - dist * 0.5 - crowding * 8;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function tunnelPlanUpdateFrontier(tp, ants) {
  tp.digFrontier = [];
  const maxDepthY = ROWS - 8;

  // 1. Main shaft
  if (tp.shaftBottom < maxDepthY) {
    tp.digFrontier.push({
      gx: tp.mainShaftX, gy: tp.shaftBottom + 1,
      type: 'shaft', angle: Math.PI * 0.5, priority: 10
    });
  }

  // 2. Secondary shaft
  if (tp.mainShaftX2 > 0 && tp.shaftBottom2 < maxDepthY) {
    tp.digFrontier.push({
      gx: tp.mainShaftX2, gy: tp.shaftBottom2 + 1,
      type: 'shaft', angle: Math.PI * 0.5, priority: 7
    });
  }

  // 3. Horizontal galleries
  const galleryInterval = Math.round((ROWS - SURFACE) * 0.15);
  for (let depth = SURFACE + galleryInterval; depth < Math.min(tp.shaftBottom, maxDepthY); depth += galleryInterval) {
    let gallery = tp.galleries.find(g => Math.abs(g.depth - depth) < 3);
    if (!gallery) {
      gallery = { depth, leftExtent: tp.mainShaftX, rightExtent: tp.mainShaftX, complete: false };
      tp.galleries.push(gallery);
    }

    if (!gallery.complete) {
      if (gallery.leftExtent > 8) {
        tp.digFrontier.push({
          gx: gallery.leftExtent - 2, gy: depth,
          type: 'gallery', angle: Math.PI, priority: 6
        });
      }
      if (gallery.rightExtent < COLS - 8) {
        tp.digFrontier.push({
          gx: gallery.rightExtent + 2, gy: depth,
          type: 'gallery', angle: 0, priority: 6
        });
      }
      const width = gallery.rightExtent - gallery.leftExtent;
      if (width > COLS * 0.4) gallery.complete = true;
    }

    // 4. Chambers at gallery ends
    if (gallery.leftExtent < tp.mainShaftX - 15) {
      tp.digFrontier.push({
        gx: gallery.leftExtent - 1, gy: depth,
        type: 'chamber', angle: Math.PI, priority: 4
      });
    }
    if (gallery.rightExtent > tp.mainShaftX + 15) {
      tp.digFrontier.push({
        gx: gallery.rightExtent + 1, gy: depth,
        type: 'chamber', angle: 0, priority: 4
      });
    }
  }

  // 5. Secondary shaft if colony is large enough
  const antCount = ants ? ants.length : 0;
  if (antCount > 15 && tp.mainShaftX2 < 0) {
    tp.mainShaftX2 = tp.mainShaftX + Math.round(COLS * 0.25) * (Math.random() < 0.5 ? 1 : -1);
    tp.mainShaftX2 = Math.max(10, Math.min(COLS - 10, tp.mainShaftX2));
    tp.shaftBottom2 = SURFACE + 2;
    tp.entrances.push({ gx: tp.mainShaftX2, depth: 0 });
  }
}

function tunnelPlanNotifyDig(tp, gx, gy, frame) {
  if (Math.abs(gx - tp.mainShaftX) < 3 && gy > tp.shaftBottom) {
    tp.shaftBottom = gy;
  }
  if (tp.mainShaftX2 > 0 && Math.abs(gx - tp.mainShaftX2) < 3 && gy > tp.shaftBottom2) {
    tp.shaftBottom2 = gy;
  }
  for (const gallery of tp.galleries) {
    if (Math.abs(gy - gallery.depth) < 2) {
      if (gx < gallery.leftExtent) gallery.leftExtent = gx;
      if (gx > gallery.rightExtent) gallery.rightExtent = gx;
    }
  }
  if (frame % 120 === 0) tunnelPlanUpdateFrontier(tp, null);
}

// =====================================================================
//  NO-OP for visual-only functions
// =====================================================================

function spawnDirt() { /* visual only — no-op in headless */ }

// =====================================================================
//  AI AWARENESS SYSTEM
// =====================================================================

function aiAwarenessPass(state) {
  const tp = state.tunnelPlan;
  if (tp.initialized) tunnelPlanUpdateFrontier(tp, state.ants);

  const diggerCount = state.ants.filter(a => a.role === 'digger').length;
  const foragerCount = state.ants.filter(a => a.role === 'forager').length;
  const totalAnts = state.ants.length;
  const foodAvail = state.foods.reduce((s, f) => s + f.amount, 0);
  const tunnelPct = state.totalDug / ((ROWS - SURFACE) * COLS);

  for (const ant of state.ants) {
    if (ant.isQueen || ant.state === ST.REST) continue;

    const gx = ant._gx(), gy = ant._gy();
    const depth = ant._depthR();
    const atSurface = ant._atSurface();
    const nearbyDiggers = state.ants.filter(a => a !== ant && a.role === 'digger' && Math.hypot(a.x - ant.x, a.y - ant.y) < 40).length;

    let thought = '';
    let action = null;

    // Too crowded — aggressively disperse when > 2 nearby diggers
    if (ant.role === 'digger' && nearbyDiggers > 2) {
      const assignment = tunnelPlanGetDigAssignment(tp, gx, gy, state.ants);
      if (assignment) {
        ant.digTargetX = assignment.gx;
        ant.digTargetY = assignment.gy;
        ant.digAngle = assignment.angle;
        ant.assignedType = assignment.type;
        action = 'reassign';
        thought = 'Too crowded, moving to extend ' + assignment.type;
      } else {
        action = 'explore';
        thought = 'Too crowded here, exploring new areas';
      }
    }
    // Hauling ants that are stuck should dig their way out
    else if (ant.state === ST.HAUL_SAND && ant.stuck > 6) {
      action = 'unstick';
      thought = 'Stuck while hauling, digging my way out';
    }
    // Colony needs diggers — cap at 35% of colony
    else if (diggerCount < totalAnts * 0.35 && tunnelPct < 0.2 && ant.role === 'idle') {
      const assignment = tunnelPlanGetDigAssignment(tp, gx, gy, state.ants);
      if (assignment) {
        ant.digTargetX = assignment.gx;
        ant.digTargetY = assignment.gy;
        ant.digAngle = assignment.angle;
        ant.assignedType = assignment.type;
        action = 'dig';
        thought = 'Colony needs tunnels, assigned to ' + assignment.type;
      } else {
        action = 'dig';
        thought = 'Colony needs more tunnels, I should dig';
      }
    }
    // Force some ants to explore for diversity
    else if (ant.role === 'idle' && state.ants.filter(a => a.role === 'explorer').length < Math.max(2, totalAnts * 0.15)) {
      action = 'explore';
      thought = 'Scouting new territory for the colony';
    }
    // Food available
    else if (foodAvail > 0 && foragerCount < 2 && ant.role !== 'forager') {
      action = 'forage';
      thought = 'Food spotted but few foragers, I should help';
    }
    // Deep and tired
    else if (depth > 0.6 && ant.energy < 300) {
      action = 'return';
      thought = 'Getting tired this deep, heading back up';
    }
    // Stuck — lower threshold
    else if (ant.stuck > 8) {
      action = 'unstick';
      thought = 'Stuck in a dead end, finding another way';
    }
    // Idle too long
    else if (ant.role === 'idle' && ant.patience > 100) {
      const assignment = tunnelPlanGetDigAssignment(tp, gx, gy, state.ants);
      if (assignment && tunnelPct < 0.3) {
        ant.digTargetX = assignment.gx;
        ant.digTargetY = assignment.gy;
        ant.digAngle = assignment.angle;
        ant.assignedType = assignment.type;
        action = 'dig';
        thought = 'Time to help dig the ' + assignment.type;
      } else {
        action = 'explore';
        thought = 'Curious about what is down there';
      }
    }
    // Tandem teaching — only when colony is spread out (not when clustered)
    else if (ant.experience > 500 && !ant.tandemTarget && nearbyDiggers < 3) {
      const naive = state.ants.find(a => a !== ant && a.experience < 100 && Math.hypot(a.x - ant.x, a.y - ant.y) < 30 && !a.tandemLeader);
      if (naive) {
        ant.tandemTarget = naive;
        naive.tandemLeader = ant;
        thought = 'Leading ' + naive.name.split('-')[0] + ' to the dig site';
        action = 'tandem';
      }
    }

    // Apply decision
    if (action === 'dig' || action === 'reassign') {
      ant.role = 'digger';
      if (atSurface) {
        ant.state = ST.ENTER;
        const entrance = tunnelPlanNearestEntrance(tp, gx);
        ant.targetX = entrance ? entrance.gx * CELL : tp.mainShaftX * CELL;
      } else if (ant.digTargetX && ant.digTargetY) {
        ant.state = ST.DIG_TO_TARGET;
      } else {
        ant.state = ST.DIG_DOWN;
      }
    } else if (action === 'explore') {
      ant.role = 'explorer';
      ant.state = ST.EXPLORE;
    } else if (action === 'forage') {
      ant.role = 'forager';
      ant.state = ST.FORAGE;
    } else if (action === 'return') {
      ant.state = ST.GO_UP;
    } else if (action === 'unstick') {
      antUnstick(state, ant, gx, gy);
    }

    ant.lastThought = thought || ant.lastThought;
    ant.lastThoughtTime = thought ? state.frame : ant.lastThoughtTime;
  }
}

// =====================================================================
//  ANT CLASS
// =====================================================================

let nextId = 1;

const ANT_NAMES = ['Ada', 'Bo', 'Cal', 'Dee', 'Emi', 'Fay', 'Gil', 'Hal', 'Ira', 'Joy', 'Kai', 'Leo', 'Mae', 'Neo', 'Ora', 'Pip', 'Quinn', 'Rex', 'Sol', 'Tia', 'Uma', 'Val', 'Wren', 'Xia', 'Yui', 'Zoe'];

function createAnt(x, y, isQueen) {
  const id = nextId++;
  const ant = {
    id: id,
    x: x, y: y, px: x, py: y,
    vx: 0, vy: 0,
    state: ST.WANDER,
    energy: 900 + Math.random() * 200,
    carrying: false,
    carryingSand: 0,
    maxSandCarry: 3 + Math.floor(Math.random() * 3),
    isQueen: isQueen || false,
    age: 0, stuck: 0, digCD: 0,
    patience: 0,
    digCount: 0,
    experience: 0,

    heading: Math.random() * 6.28,
    digAngle: Math.PI * 0.5,
    targetX: -1, targetY: -1,

    meanderPhase: Math.random() * 6.28,
    meanderFreq: 0.08 + Math.random() * 0.04,

    pauseTimer: 0,
    pauseDuration: 0,
    nextPauseAt: 8 + Math.random() * 12,
    isPaused: false,

    restTimer: 0,
    nextRestAt: 180 + Math.random() * 220,
    restDuration: 35 + Math.random() * 45,
    timeSinceRest: 0,

    threshold: {
      dig: 0.1 + Math.random() * 0.8,
      forage: 0.1 + Math.random() * 0.8,
      explore: 0.1 + Math.random() * 0.8,
    },

    role: 'idle',
    memory: [],
    memoryTimer: 0,

    tandemTarget: null,
    tandemLeader: null,

    antennateTimer: 0,
    antennateTarget: null,

    lastThought: '',
    lastThoughtTime: 0,

    digTargetX: -1,
    digTargetY: -1,
    assignedType: '',

    bodyBob: 0,
    bodyBobPhase: Math.random() * 6.28,

    name: (isQueen ? 'Queen ' : '') + ANT_NAMES[id % ANT_NAMES.length] + '-' + id,

    size: isQueen ? 4.5 : 3.0 + Math.random() * 0.5,
    hue: Math.random() * 15,
    legT: Math.random() * 6.28,
    antT: Math.random() * 6.28,
  };

  // Attach helper methods
  ant._gx = function() { return (this.x / CELL) | 0; };
  ant._gy = function() { return (this.y / CELL) | 0; };
  ant._depthR = function() { return Math.max(0, (this._gy() - SURFACE) / (ROWS - SURFACE)); };
  ant._atSurface = function() { return this._gy() <= SURFACE + 2; };
  ant._currentSpeed = function() {
    if (this.isPaused) return 0.05;
    if (this.state === ST.TANDEM_LEAD) return TANDEM_SPEED;
    return (this.carrying || this.carryingSand > 0) ? LOADED_SPEED : BASE_SPEED;
  };

  return ant;
}

// =====================================================================
//  ANT BEHAVIOR — sense / think / act
// =====================================================================

function antSense(state, ant) {
  const gx = ant._gx(), gy = ant._gy();
  const s = {
    gx: gx, gy: gy,
    surface: ant._atSurface(),
    depth: ant._depthR(),
    below: isSolid(state, gx, gy + 1),
    above: isSolid(state, gx, gy - 1),
    left: isSolid(state, gx - 1, gy),
    right: isSolid(state, gx + 1, gy),
    food: null, foodDist: 999,
    trailGrad: phGradient(state, gx, gy, 'phTrail', 6),
    foodGrad: phGradient(state, gx, gy, 'phFood', 6),
    digGrad: phGradient(state, gx, gy, 'phDig', 5),
    trailHere: phGet(state, gx, gy, 'phTrail'),
    foodHere: phGet(state, gx, gy, 'phFood'),
    digHere: phGet(state, gx, gy, 'phDig'),
    nearAnts: 0, nearDiggers: 0, nearForagers: 0,
    wallDir: null,
  };

  for (const f of state.foods) {
    const d = Math.hypot(f.x - ant.x, f.y - ant.y);
    if (d < 60 && d < s.foodDist) { s.food = f; s.foodDist = d; }
  }

  for (const a of state.ants) {
    if (a === ant) continue;
    const dist = Math.hypot(a.x - ant.x, a.y - ant.y);
    if (dist < 25) {
      s.nearAnts++;
      if (a.role === 'digger') s.nearDiggers++;
      if (a.role === 'forager') s.nearForagers++;
    }
    if (dist < ANT_BODY_PX && ant.antennateTimer <= 0 && Math.random() < 0.01) {
      ant.antennateTarget = a;
      ant.antennateTimer = 30;
    }
  }

  if (!s.surface) {
    const wallL = isSolid(state, gx - 1, gy) ? 1 : 0;
    const wallR = isSolid(state, gx + 1, gy) ? 1 : 0;
    const wallU = isSolid(state, gx, gy - 1) ? 1 : 0;
    const wallD = isSolid(state, gx, gy + 1) ? 1 : 0;
    if (wallL + wallR + wallU + wallD > 0 && wallL + wallR + wallU + wallD < 4) {
      s.wallDir = { l: wallL, r: wallR, u: wallU, d: wallD };
    }
  }

  return s;
}

function antThink(state, ant, s) {
  ant.timeSinceRest++;
  const tp = state.tunnelPlan;

  // Antennation
  if (ant.antennateTimer > 0) {
    ant.antennateTimer--;
    if (ant.antennateTarget && ant.antennateTimer > 20) {
      const other = ant.antennateTarget;
      if (ant.carrying && other.threshold.forage > 0.5) {
        other.threshold.forage *= 0.8;
      }
      if (ant.role === 'digger' && other.role === 'idle') {
        other.threshold.dig *= 0.85;
      }
    }
    if (ant.antennateTimer <= 0) ant.antennateTarget = null;
  }

  // Micro-pauses
  if (!ant.isPaused && ant.state !== ST.REST) {
    ant.pauseTimer++;
    if (ant.pauseTimer >= ant.nextPauseAt) {
      ant.isPaused = true;
      ant.pauseDuration = 1 + Math.random() * 2;
      ant.pauseTimer = 0;
      ant.nextPauseAt = 40 + Math.random() * 60;
    }
  }
  if (ant.isPaused) {
    ant.pauseDuration--;
    if (ant.pauseDuration <= 0) ant.isPaused = false;
  }

  // Rest cycle — do NOT interrupt active dig/enter states
  const busyStates = [ST.CARRY, ST.HAUL_SAND, ST.DIG_TO_TARGET, ST.ENTER, ST.DIG_DOWN, ST.DIG_BRANCH, ST.DIG_CHAMBER];
  if (ant.timeSinceRest > ant.nextRestAt && busyStates.indexOf(ant.state) === -1) {
    ant._preRestState = ant.state;
    ant.state = ST.REST;
    ant.restTimer = 0;
    ant.timeSinceRest = 0;
    ant.nextRestAt = 180 + Math.random() * 220;
    return;
  }
  if (ant.state === ST.REST) {
    ant.restTimer++;
    ant.energy += 0.6;
    if (ant.restTimer > ant.restDuration) {
      ant.restTimer = 0;
      // Restore previous state if it was an active task, otherwise wander
      const prevState = ant._preRestState;
      if (prevState !== undefined && prevState !== ST.REST && prevState !== ST.WANDER) {
        ant.state = prevState;
      } else {
        ant.state = ST.WANDER;
      }
      ant._preRestState = undefined;
    }
    return;
  }

  if (ant.energy < 50) { ant.state = ST.REST; ant.restTimer = 0; return; }
  if (ant.isQueen) { ant.state = ST.WANDER; return; }

  if (ant.carrying) { ant.state = ST.CARRY; return; }
  if (ant.carryingSand > 0) { ant.state = ST.HAUL_SAND; return; }

  // Tandem running: leader
  if (ant.tandemTarget) {
    const dist = Math.hypot(ant.tandemTarget.x - ant.x, ant.tandemTarget.y - ant.y);
    if (dist > 80 || ant.tandemTarget.energy < 50) {
      ant.tandemTarget.tandemLeader = null;
      ant.tandemTarget = null;
    } else {
      ant.state = ST.TANDEM_LEAD;
      return;
    }
  }
  // Tandem running: follower
  if (ant.tandemLeader) {
    if (Math.hypot(ant.tandemLeader.x - ant.x, ant.tandemLeader.y - ant.y) > 80) {
      ant.tandemLeader.tandemTarget = null;
      ant.tandemLeader = null;
    } else {
      ant.state = ST.TANDEM_FOLLOW;
      return;
    }
  }

  // Utility-based decision
  let scores = { dig: 0, forage: 0, explore: 0, rest: 0, wander: 0 };

  const digStim = s.digHere + (s.digGrad.strength * 0.5);
  if (digStim > ant.threshold.dig) {
    scores.dig = (digStim - ant.threshold.dig) * 3;
    scores.dig *= Math.max(0.1, 1 - s.nearDiggers * 0.25);
  }

  const foodStim = s.foodHere + (s.food ? 0.5 : 0) + s.foodGrad.strength * 0.3;
  if (foodStim > ant.threshold.forage) {
    scores.forage = (foodStim - ant.threshold.forage) * 4;
    scores.forage *= Math.max(0.1, 1 - s.nearForagers * 0.2);
  }

  const exploreStim = s.trailGrad.strength * 0.3 + (1 - s.depth) * 0.2;
  if (exploreStim > ant.threshold.explore * 0.5) {
    scores.explore = exploreStim * 2;
  }

  if (s.surface) scores.wander = 0.5;

  let best = 'wander', bestScore = scores.wander;
  for (const [action, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = action; }
  }

  // On surface
  if (s.surface) {
    // If ant is already in an active digging/entering task, don't interrupt
    if (ant.state === ST.ENTER || ant.state === ST.DIG_DOWN || ant.state === ST.DIG_BRANCH ||
        ant.state === ST.DIG_CHAMBER || ant.state === ST.DIG_TO_TARGET || ant.state === ST.HAUL_SAND ||
        ant.state === ST.GO_UP) {
      return;
    }

    if (best === 'forage' && s.food) {
      ant.state = ST.FORAGE; ant.targetX = s.food.x; ant.targetY = s.food.y;
      ant.role = 'forager'; return;
    }
    if (best === 'forage' && s.foodGrad.angle !== null) {
      ant.state = ST.FORAGE; ant.heading = s.foodGrad.angle;
      ant.role = 'forager'; return;
    }

    ant.patience++;
    const threshold = 80 + (1 - scores.dig) * 120;
    if (ant.patience > threshold || best === 'dig') {
      ant.patience = 0;
      ant.role = 'digger';

      if (!tp.initialized) tunnelPlanInit(tp);

      const assignment = tunnelPlanGetDigAssignment(tp, ant._gx(), ant._gy(), state.ants);
      if (assignment) {
        ant.digTargetX = assignment.gx;
        ant.digTargetY = assignment.gy;
        ant.digAngle = assignment.angle;
        ant.assignedType = assignment.type;
      }

      // FIX: Always use an established entrance — no random chance, always reuse
      const entrance = tunnelPlanNearestEntrance(tp, ant._gx());
      if (entrance) {
        // FIX: Converge to EXACT mainShaftX, not "near" the entrance
        ant.targetX = entrance.gx * CELL;
        ant.state = ST.ENTER;
      } else {
        ant.state = ST.DIG_DOWN;
        ant.digCount = 0;
        ant.digAngle = Math.PI * 0.5;
        tp.entrances.push({ gx: ant._gx(), depth: 0 });
      }
      return;
    }

    ant.state = ST.WANDER; ant.role = 'idle';
    return;
  }

  // Underground — DIG_TO_TARGET
  if (ant.state === ST.DIG_TO_TARGET) {
    if (ant.digCount >= ant.maxSandCarry) {
      ant.carryingSand = ant.digCount;
      ant.digCount = 0;
      ant.state = ST.HAUL_SAND;
      return;
    }
    if (ant.digTargetX > 0 && ant.digTargetY > 0) {
      const tdx = ant.digTargetX - s.gx, tdy = ant.digTargetY - s.gy;
      const tdist = Math.hypot(tdx, tdy);
      if (tdist < 4) {
        if (ant.assignedType === 'shaft') {
          ant.state = ST.DIG_DOWN;
          ant.digAngle = Math.PI * 0.5;
          // Force exact shaft X alignment
          const dist1 = Math.abs(s.gx - tp.mainShaftX);
          const dist2 = tp.mainShaftX2 > 0 ? Math.abs(s.gx - tp.mainShaftX2) : Infinity;
          const shaftX = dist1 <= dist2 ? tp.mainShaftX : tp.mainShaftX2;
          ant.x = shaftX * CELL + CELL / 2;
          ant.vx = 0;
        } else if (ant.assignedType === 'chamber') {
          ant.state = ST.DIG_CHAMBER;
          ant.patience = 0;
        } else {
          ant.state = ST.DIG_BRANCH;
          ant.digAngle = ant.digAngle || (Math.random() < 0.5 ? 0 : Math.PI);
        }
        ant.digTargetX = -1;
        ant.digTargetY = -1;
        return;
      }
      ant.digAngle = Math.atan2(tdy, tdx);
      ant.heading = ant.digAngle;
    }
    return;
  }

  // Underground — structured digging
  if (ant.state === ST.DIG_DOWN || ant.state === ST.DIG_BRANCH || ant.state === ST.DIG_CHAMBER) {
    if (ant.digCount >= ant.maxSandCarry) {
      ant.carryingSand = ant.digCount;
      ant.digCount = 0;
      ant.state = ST.HAUL_SAND;
      return;
    }

    // DIG_DOWN (shaft)
    if (ant.state === ST.DIG_DOWN) {
      const galleryInterval = Math.round((ROWS - SURFACE) * 0.15);
      const depthInGround = s.gy - SURFACE;
      if (depthInGround > 5 && depthInGround % galleryInterval < 2 && Math.random() < 0.08) {
        ant.state = ST.DIG_BRANCH;
        ant.digAngle = Math.random() < 0.5 ? 0 : Math.PI;
        ant.digAngle += (Math.random() - 0.5) * 0.15;
        return;
      }
      if (s.depth > 0.7 && Math.random() < 0.02) {
        ant.state = Math.random() < 0.3 ? ST.DIG_CHAMBER : ST.GO_UP;
        ant.patience = 0;
        return;
      }
      // FIX: Do NOT add random wander to dig angle for shafts
      // FIX: Clamp angle VERY tightly to exactly PI/2 (pure vertical)
      ant.digAngle = Math.PI * 0.5;
      return;
    }

    // DIG_BRANCH (gallery)
    if (ant.state === ST.DIG_BRANCH) {
      if (Math.random() < 0.006) ant.digAngle += (Math.random() - 0.5) * 0.3;
      const nearestH = Math.abs(ant.digAngle) < Math.PI * 0.5 ? 0 : Math.PI;
      ant.digAngle = ant.digAngle * 0.95 + nearestH * 0.05;
      if (Math.random() < 0.004) {
        if (Math.random() < 0.4) {
          ant.state = ST.DIG_CHAMBER;
          ant.patience = 0;
        } else {
          ant.state = Math.random() < 0.5 ? ST.GO_UP : ST.EXPLORE;
        }
      }
      return;
    }

    // DIG_CHAMBER
    if (ant.state === ST.DIG_CHAMBER) {
      ant.patience++;
      const maxSize = 100 - s.depth * 40;
      if (ant.patience > maxSize) {
        ant.state = Math.random() < 0.4 ? ST.GO_UP : ST.EXPLORE;
        ant.patience = 0;
        phSet(state, s.gx, s.gy, 0.8, 'phDig');
      }
      return;
    }
    return;
  }

  if (ant.state === ST.EXPLORE || ant.state === ST.WALL_FOLLOW) {
    if (s.wallDir) ant.state = ST.WALL_FOLLOW;
    else ant.state = ST.EXPLORE;

    if (s.trailGrad.angle !== null && s.trailGrad.strength > 0.05) {
      ant.heading = ant.heading * 0.7 + s.trailGrad.angle * 0.3;
    }
    if (s.digGrad.angle !== null && s.digGrad.strength > ant.threshold.dig) {
      const assignment = tunnelPlanGetDigAssignment(tp, s.gx, s.gy, state.ants);
      if (assignment) {
        ant.digTargetX = assignment.gx;
        ant.digTargetY = assignment.gy;
        ant.digAngle = assignment.angle;
        ant.assignedType = assignment.type;
        ant.state = ST.DIG_TO_TARGET;
      } else {
        ant.state = ST.DIG_BRANCH;
        ant.digAngle = s.digGrad.angle;
      }
      ant.role = 'digger';
      return;
    }
    if (Math.random() < 0.003) {
      if (scores.dig > 0.3) {
        const assignment = tunnelPlanGetDigAssignment(tp, s.gx, s.gy, state.ants);
        if (assignment) {
          ant.digTargetX = assignment.gx;
          ant.digTargetY = assignment.gy;
          ant.digAngle = assignment.angle;
          ant.assignedType = assignment.type;
          ant.state = ST.DIG_TO_TARGET;
          ant.role = 'digger';
        } else {
          ant.state = ST.GO_UP;
        }
      } else {
        ant.state = ST.GO_UP;
      }
    }
    return;
  }

  if (ant.state === ST.GO_UP || ant.state === ST.CARRY || ant.state === ST.HAUL_SAND) {
    if (s.surface) {
      if (ant.carryingSand > 0) {
        for (let i = 0; i < ant.carryingSand; i++) {
          depositSandOnSurface(state, ant._gx() + Math.round((Math.random() - 0.5) * 3));
        }
        ant.carryingSand = 0;
      }
      ant.state = ST.WANDER; ant.patience = 0;
      if (ant.carrying) ant.carrying = false;
      ant.role = 'idle';
    }
    return;
  }

  ant.state = ST.EXPLORE;
}

// ── Movement helpers ──

function antCorrelatedWalk(ant, spd, turnRange) {
  const range = turnRange || 0.35;
  ant.heading += (Math.random() - 0.5) * range;

  ant.meanderPhase += ant.meanderFreq;
  const meander = Math.sin(ant.meanderPhase) * 0.08;
  ant.heading += meander;

  if (ant.memory.length > 2) {
    const last = ant.memory[ant.memory.length - 1];
    const dx = ant._gx() - last.x, dy = ant._gy() - last.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
      ant.heading += (Math.random() - 0.5) * 2;
    }
  }

  ant.vx += Math.cos(ant.heading) * spd * 0.45;
  ant.vy += Math.sin(ant.heading) * spd * 0.45;
}

function antWander(state, ant, s, spd) {
  antCorrelatedWalk(ant, spd, 0.4);
  const surfY = SURFACE_PX - CELL;
  if (ant.y < surfY - CELL * 2) { ant.vy += 0.5; ant.y = Math.max(ant.y, surfY - CELL * 4); }
  if (ant.y < surfY) ant.vy += 0.2;
  if (ant.y > surfY + CELL * 2) ant.vy -= 0.15;
  if (ant.x < FRAME + CELL * 2) { ant.vx += 0.3; ant.heading = 0; }
  if (ant.x > W - FRAME - CELL * 2) { ant.vx -= 0.3; ant.heading = Math.PI; }
  ant.vx *= 0.92; ant.vy *= 0.92;
}

function antEnter(state, ant, s, spd) {
  const tp = state.tunnelPlan;
  if (ant.targetX >= 0) {
    const dx = ant.targetX - ant.x;
    if (Math.abs(dx) > CELL * 6) {
      // Walk toward entrance from far away
      ant.vx += Math.sign(dx) * spd * 0.5;
      ant.heading = dx > 0 ? 0 : Math.PI;
      if (ant.y < SURFACE_PX - CELL) ant.vy += 0.2;
    } else {
      // HARD SNAP to exact entrance X before descending — prevents V-shape
      const entrance = tunnelPlanNearestEntrance(tp, ant._gx());
      if (entrance) {
        ant.x = entrance.gx * CELL + CELL / 2;
      }
      ant.vx = 0; // zero lateral movement immediately
      ant.vy += spd * 0.5;
      ant.heading = Math.PI * 0.5;
      ant.targetX = -1;

      if (ant.digTargetX > 0 && ant.digTargetY > 0) {
        ant.state = ST.DIG_TO_TARGET;
      } else {
        ant.state = ST.DIG_DOWN;
        ant.digAngle = Math.PI * 0.5;
        ant.digCount = 0;
      }
    }
  }
  ant.vx *= 0.92; ant.vy *= 0.92;
}

function antDigTunnel(state, ant, s, spd) {
  const isDrilling = ant.state === ST.DIG_DOWN;
  const tp = state.tunnelPlan;

  // Shaft digging: force EXACTLY vertical with HARD position constraint
  if (isDrilling) {
    ant.digAngle = Math.PI * 0.5;
    // HARD CONSTRAINT: Set position directly to shaft center — no drift allowed
    const nearShaft1 = Math.abs(ant._gx() - tp.mainShaftX) < 5;
    const nearShaft2 = tp.mainShaftX2 > 0 && Math.abs(ant._gx() - tp.mainShaftX2) < 5;
    if (nearShaft1) {
      ant.x = tp.mainShaftX * CELL + CELL / 2;
      ant.vx = 0;
    } else if (nearShaft2) {
      ant.x = tp.mainShaftX2 * CELL + CELL / 2;
      ant.vx = 0;
    }
  }

  const dx = Math.cos(ant.digAngle), dy = Math.sin(ant.digAngle);
  ant.heading = ant.digAngle;

  ant.vx += dx * spd * 0.12;
  ant.vy += dy * spd * 0.18;
  ant.vx *= 0.8; ant.vy *= 0.8;

  if (ant.digCD <= 0) {
    const fwdX = s.gx + Math.round(dx * 2), fwdY = s.gy + Math.round(dy * 2);
    if (isSolid(state, fwdX, fwdY)) {
      const hardness = cellAt(state, fwdX, fwdY);
      if (hardness >= 5) {
        ant.digAngle += (Math.random() - 0.5) * 0.8;
        ant.digCD = 10;
      } else {
        // Single-cell dig near surface to prevent V-shape, wider deeper
        const depthBelowSurface = s.gy - SURFACE;
        let dugCount = 0;
        if (isDrilling && depthBelowSurface < 15) {
          // Single cell dig — ONLY the forward cell, no lateral spread
          const result = digCell(state, fwdX, fwdY);
          if (result) { dugCount++; ant.digCount++; }
          // Also dig one cell directly below for vertical progress
          const result2 = digCell(state, fwdX, fwdY + 1);
          if (result2) { dugCount++; ant.digCount++; }
        } else {
          // Wider dig deeper underground (radius 1)
          const digRadius = isDrilling ? 1 : 1;
          for (let ddx = -1; ddx <= 1; ddx++) for (let ddy = -1; ddy <= 1; ddy++) {
            if (ddx * ddx + ddy * ddy <= digRadius * digRadius && dugCount < 3) {
              const result = digCell(state, fwdX + ddx, fwdY + ddy);
              if (result) { dugCount++; ant.digCount++; }
            }
          }
        }
        ant.digCD = 8 + (hardness * 2) + (Math.random() * 4) | 0;
        ant.energy -= 0.4;
        phSet(state, s.gx, s.gy, 0.4, 'phDig');
        if (dugCount > 0) {
          spawnDirt(fwdX * CELL, fwdY * CELL);
          tunnelPlanNotifyDig(tp, fwdX, fwdY, state.frame);
        }
      }
    } else {
      ant.vx += dx * spd * 0.3;
      ant.vy += dy * spd * 0.3;
      ant.digCD = 3;
    }
  }
}

function antDigChamber(state, ant, s, spd) {
  const tp = state.tunnelPlan;
  ant.heading += 0.06 + Math.random() * 0.03;
  ant.vx += Math.cos(ant.heading) * spd * 0.18;
  ant.vy += Math.sin(ant.heading) * spd * 0.18;
  ant.vx *= 0.8; ant.vy *= 0.8;

  if (ant.digCD <= 0) {
    let dugCount = 0;
    for (let ddx = -2; ddx <= 2; ddx++) for (let ddy = -2; ddy <= 2; ddy++) {
      if (ddx * ddx + ddy * ddy <= 5 && Math.random() < 0.5 && dugCount < 4) {
        const result = digCell(state, s.gx + ddx, s.gy + ddy);
        if (result) { dugCount++; ant.digCount++; }
      }
    }
    ant.digCD = 14 + (Math.random() * 10) | 0;
    ant.energy -= 0.35;
    if (dugCount > 0) {
      spawnDirt(ant.x, ant.y);
      tunnelPlanNotifyDig(tp, s.gx, s.gy, state.frame);
    }
  }
}

function antDigToTarget(state, ant, s, spd) {
  const tp = state.tunnelPlan;
  if (ant.digTargetX < 0 || ant.digTargetY < 0) {
    ant.state = ST.EXPLORE;
    return;
  }
  const tdx = ant.digTargetX - s.gx, tdy = ant.digTargetY - s.gy;
  const tdist = Math.hypot(tdx, tdy);

  if (tdist < 4) {
    if (ant.assignedType === 'shaft') {
      ant.state = ST.DIG_DOWN;
      ant.digAngle = Math.PI * 0.5;
      // Force exact shaft X alignment
      const dist1 = Math.abs(s.gx - tp.mainShaftX);
      const dist2 = tp.mainShaftX2 > 0 ? Math.abs(s.gx - tp.mainShaftX2) : Infinity;
      const shaftX = dist1 <= dist2 ? tp.mainShaftX : tp.mainShaftX2;
      ant.x = shaftX * CELL + CELL / 2;
      ant.vx = 0;
    } else if (ant.assignedType === 'chamber') {
      ant.state = ST.DIG_CHAMBER;
      ant.patience = 0;
    } else {
      ant.state = ST.DIG_BRANCH;
      ant.digAngle = s.gx < tp.mainShaftX ? Math.PI : 0;
    }
    ant.digTargetX = -1;
    ant.digTargetY = -1;
    return;
  }

  const angle = Math.atan2(tdy, tdx);
  ant.heading = ant.heading * 0.6 + angle * 0.4;
  const dx = Math.cos(ant.heading), dy = Math.sin(ant.heading);

  const aheadX = s.gx + Math.round(dx * 2), aheadY = s.gy + Math.round(dy * 2);
  if (!isSolid(state, aheadX, aheadY)) {
    ant.vx += dx * spd * 0.4;
    ant.vy += dy * spd * 0.4;
  } else {
    if (ant.digCD <= 0) {
      let dugCount = 0;
      for (let ddx = -1; ddx <= 1; ddx++) for (let ddy = -1; ddy <= 1; ddy++) {
        if (ddx * ddx + ddy * ddy <= 1 && dugCount < 2) {
          const result = digCell(state, aheadX + ddx, aheadY + ddy);
          if (result) { dugCount++; ant.digCount++; }
        }
      }
      ant.digCD = 8;
      if (dugCount > 0) {
        spawnDirt(aheadX * CELL, aheadY * CELL);
        tunnelPlanNotifyDig(tp, aheadX, aheadY, state.frame);
      }
    }
    ant.vx += dx * spd * 0.15;
    ant.vy += dy * spd * 0.15;
  }
  ant.vx *= 0.85; ant.vy *= 0.85;
}

function antExplore(state, ant, s, spd) {
  const tp = state.tunnelPlan;
  const turnRange = ant.experience > 500 ? 0.25 : 0.6;
  antCorrelatedWalk(ant, spd, turnRange);

  const aheadX = s.gx + Math.round(Math.cos(ant.heading) * 3);
  const aheadY = s.gy + Math.round(Math.sin(ant.heading) * 3);
  if (isSolid(state, aheadX, aheadY)) {
    ant.heading += Math.PI * 0.5 + (Math.random() - 0.5) * 0.5;
    if (ant.threshold.dig < 0.3 && ant.digCD <= 0 && Math.random() < 0.08) {
      let dugCount = 0;
      for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) {
        const r = digCell(state, aheadX + d, aheadY + e);
        if (r) { ant.digCount++; dugCount++; }
      }
      ant.digCD = 12;
      if (dugCount > 0) tunnelPlanNotifyDig(tp, aheadX, aheadY, state.frame);
    }
  }
  ant.vx *= 0.88; ant.vy *= 0.88;
}

function antWallFollow(state, ant, s, spd) {
  if (!s.wallDir) { ant.state = ST.EXPLORE; return; }
  const w = s.wallDir;

  let targetAngle = ant.heading;
  if (w.r && !isSolid(state, s.gx + Math.round(Math.cos(ant.heading)), s.gy + Math.round(Math.sin(ant.heading)))) {
    // Wall on right, ahead clear
  } else if (!w.r && !w.d) {
    targetAngle = ant.heading + 0.4;
  } else if (isSolid(state, s.gx + Math.round(Math.cos(ant.heading)), s.gy + Math.round(Math.sin(ant.heading)))) {
    targetAngle = ant.heading - 0.6;
  }

  ant.heading = ant.heading * 0.8 + targetAngle * 0.2;
  ant.vx += Math.cos(ant.heading) * spd * 0.4;
  ant.vy += Math.sin(ant.heading) * spd * 0.4;
  ant.vx *= 0.88; ant.vy *= 0.88;
}

function antGoUp(state, ant, s, spd) {
  let best = -Math.PI / 2, bestS = -999;
  // Search wider radius (3 cells) for escape routes
  for (let a = -Math.PI; a < Math.PI; a += 0.25) {
    for (let r = 2; r <= 3; r++) {
      const cx = s.gx + Math.round(Math.cos(a) * r), cy = s.gy + Math.round(Math.sin(a) * r);
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) continue;
      if (!isSolid(state, cx, cy)) {
        const upBias = -Math.sin(a) * 3.5;  // Stronger upward bias
        const trailBonus = phGet(state, cx, cy, 'phTrail') * 0.5;
        const sc = upBias + trailBonus;
        if (sc > bestS) { bestS = sc; best = a; }
      }
    }
  }
  ant.heading = ant.heading * 0.4 + best * 0.6;  // More responsive steering
  ant.vx += Math.cos(ant.heading) * spd * 0.45;   // Faster movement
  ant.vy += Math.sin(ant.heading) * spd * 0.45;
  // Emergency dig ONLY directly upward (don't widen tunnels laterally)
  if (ant.stuck > 10 && ant.digCD <= 0) {
    digCell(state, s.gx, s.gy - 1);
    digCell(state, s.gx, s.gy - 2);
    ant.digCD = 6;
  }
  // If stuck a long time, drop the sand and switch to explore
  if (ant.stuck > 25) {
    ant.carryingSand = 0;
    ant.state = ST.EXPLORE;
    ant.stuck = 0;
  }
  ant.vx *= 0.85; ant.vy *= 0.85;
}

function antForage(state, ant, s, spd) {
  if (ant.targetX >= 0 && s.food) {
    const dx = ant.targetX - ant.x, dy = ant.targetY - ant.y, d = Math.hypot(dx, dy);
    if (d > 4) {
      ant.heading = Math.atan2(dy, dx);
      ant.vx += (dx / d) * spd * 0.55;
      ant.vy += (dy / d) * spd * 0.55;
    }
  } else if (s.foodGrad.angle !== null) {
    ant.heading = ant.heading * 0.6 + s.foodGrad.angle * 0.4;
    ant.vx += Math.cos(ant.heading) * spd * 0.4;
    ant.vy += Math.sin(ant.heading) * spd * 0.4;
  } else {
    antCorrelatedWalk(ant, spd, 0.5);
  }
  ant.vx *= 0.9; ant.vy *= 0.9;
}

function antTandemLead(state, ant, s, spd) {
  if (!ant.tandemTarget) { ant.state = ST.EXPLORE; return; }
  const target = ant.tandemTarget;
  const dist = Math.hypot(target.x - ant.x, target.y - ant.y);

  if (dist > 30) {
    ant.vx *= 0.3; ant.vy *= 0.3;
    return;
  }

  ant.vy += spd * 0.15;
  antCorrelatedWalk(ant, spd * 0.5, 0.3);
  ant.vx *= 0.85; ant.vy *= 0.85;

  if (ant._depthR() > 0.3) {
    target.tandemLeader = null;
    target.role = 'digger';
    target.state = ST.DIG_BRANCH;
    target.threshold.dig *= 0.5;
    target.experience += 200;
    ant.tandemTarget = null;
    ant.state = ST.EXPLORE;
  }
}

function antTandemFollow(state, ant, s, spd) {
  if (!ant.tandemLeader) { ant.state = ST.EXPLORE; return; }
  const leader = ant.tandemLeader;
  const dx = leader.x - ant.x, dy = leader.y - ant.y;
  const d = Math.hypot(dx, dy);

  if (d > 8) {
    ant.vx += (dx / d) * spd * 0.5;
    ant.vy += (dy / d) * spd * 0.5;
  }
  ant.vx *= 0.88; ant.vy *= 0.88;
  ant.experience += 0.5;
}

function antUnstick(state, ant, gx, gy) {
  // BFS but prefer upward directions (toward surface) to avoid jamming deeper
  const seen = new Set(), q = [[gx, gy]]; seen.add(gx + ',' + gy);
  let bestEmpty = null, bestDist = 99999;
  let searched = 0;
  while (q.length && searched < 500) {
    const [cx, cy] = q.shift();
    searched++;
    if (!isSolid(state, cx, cy) && cy >= 0 && cy < ROWS) {
      // Prefer cells closer to surface (lower y)
      const score = cy + Math.abs(cx - gx) * 0.3;
      if (score < bestDist) {
        bestDist = score;
        bestEmpty = [cx, cy];
      }
      // If we found one close to surface, use it immediately
      if (cy < gy) {
        ant.x = cx * CELL + CELL / 2; ant.y = cy * CELL + CELL / 2;
        ant.vx = 0; ant.vy = -0.5; return;
      }
    }
    // Search upward first
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
      if (!seen.has(k) && nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
        seen.add(k); q.push([nx, ny]);
      }
    }
    if (seen.size > 500) break;
  }
  // Use best found empty cell as fallback
  if (bestEmpty) {
    ant.x = bestEmpty[0] * CELL + CELL / 2;
    ant.y = bestEmpty[1] * CELL + CELL / 2;
    ant.vx = 0; ant.vy = -0.3;
  }
}

function antAct(state, ant, s) {
  ant.age++;
  ant.experience++;
  ant.energy -= 0.1;
  const moving = ant.state !== ST.REST && !ant.isPaused;
  ant.legT += moving ? 0.22 : 0;
  ant.antT += 0.07;
  if (ant.digCD > 0) ant.digCD--;

  // Body oscillation
  if (moving) {
    ant.bodyBobPhase += 0.3;
    if (ant.carrying || ant.carryingSand > 0) {
      ant.bodyBob = Math.sin(ant.bodyBobPhase) * 0.4 + Math.sin(ant.bodyBobPhase * 2.7) * 0.3;
    } else {
      ant.bodyBob = Math.sin(ant.bodyBobPhase) * 0.3;
    }
  }

  // Memory
  ant.memoryTimer++;
  if (ant.memoryTimer > 30) {
    ant.memory.push({ x: ant._gx(), y: ant._gy() });
    if (ant.memory.length > 8) ant.memory.shift();
    ant.memoryTimer = 0;
  }

  // Pheromone deposition
  const gx = s.gx, gy = s.gy;
  if (ant.carrying) {
    phSet(state, gx, gy, 0.3, 'phFood');
    phSet(state, gx, gy, 0.2, 'phTrail');
  } else if (ant.carryingSand > 0) {
    phSet(state, gx, gy, 0.15, 'phTrail');
  } else if (ant.state === ST.DIG_DOWN || ant.state === ST.DIG_BRANCH || ant.state === ST.DIG_CHAMBER || ant.state === ST.DIG_TO_TARGET) {
    phSet(state, gx, gy, 0.25, 'phDig');
    phSet(state, gx, gy, 0.15, 'phTrail');
  } else {
    phSet(state, gx, gy, 0.06, 'phTrail');
  }

  const spd = ant._currentSpeed();

  switch (ant.state) {
    case ST.WANDER: antWander(state, ant, s, spd); break;
    case ST.ENTER: antEnter(state, ant, s, spd); break;
    case ST.DIG_DOWN: case ST.DIG_BRANCH: antDigTunnel(state, ant, s, spd); break;
    case ST.DIG_CHAMBER: antDigChamber(state, ant, s, spd); break;
    case ST.DIG_TO_TARGET: antDigToTarget(state, ant, s, spd); break;
    case ST.EXPLORE: antExplore(state, ant, s, spd); break;
    case ST.WALL_FOLLOW: antWallFollow(state, ant, s, spd); break;
    case ST.GO_UP: case ST.CARRY: case ST.HAUL_SAND: antGoUp(state, ant, s, spd); break;
    case ST.FORAGE: antForage(state, ant, s, spd); break;
    case ST.TANDEM_LEAD: antTandemLead(state, ant, s, spd); break;
    case ST.TANDEM_FOLLOW: antTandemFollow(state, ant, s, spd); break;
    case ST.REST: break;
  }

  // Food pickup
  if (!ant.carrying) {
    for (let i = state.foods.length - 1; i >= 0; i--) {
      if (Math.hypot(state.foods[i].x - ant.x, state.foods[i].y - ant.y) < CELL * 3) {
        state.foods[i].amount--;
        if (state.foods[i].amount <= 0) state.foods.splice(i, 1);
        ant.carrying = true;
        ant.energy = Math.min(1100, ant.energy + 400);
        ant.state = ST.CARRY; ant.role = 'forager'; break;
      }
    }
  }
  if (ant.carrying && s.surface) { ant.carrying = false; ant.state = ST.WANDER; ant.role = 'idle'; }

  // Physics
  if (!s.below && gy < ROWS - 1) ant.vy += 0.2;
  if ((s.left || s.right) && !s.below) ant.vy *= 0.35;

  // Ant-ant repulsion — gentle push to prevent piling, but only underground
  // Surface ants don't need it (they wander freely)
  // Only push vertically (vy) to avoid disrupting shaft alignment
  if (gy > SURFACE) {
    let repelX = 0, repelY = 0, neighbors = 0;
    for (const other of state.ants) {
      if (other === ant) continue;
      const dx = ant.x - other.x, dy = ant.y - other.y;
      const dist = Math.hypot(dx, dy);
      if (dist < CELL * 2.5 && dist > 0.1) {
        const force = (CELL * 2.5 - dist) * 0.015;
        repelY += (dy / dist) * force;
        neighbors++;
      }
    }
    // Only apply vertical repulsion (don't push sideways in shafts)
    if (neighbors > 0) {
      ant.vy += repelY;
    }
  }

  const maxV = spd * 3;
  ant.vx = Math.max(-maxV, Math.min(maxV, ant.vx));
  ant.vy = Math.max(-maxV, Math.min(maxV, ant.vy));

  ant.px = ant.x; ant.py = ant.y;
  let nx = ant.x + ant.vx, ny = ant.y + ant.vy;
  const ngx = (nx / CELL) | 0, ngy = (ny / CELL) | 0;

  const digging = ant.state === ST.DIG_DOWN || ant.state === ST.DIG_BRANCH || ant.state === ST.DIG_CHAMBER || ant.state === ST.DIG_TO_TARGET;
  if (isSolid(state, ngx, ngy) && !digging) {
    if (!isSolid(state, s.gx, ngy)) { nx = ant.x; ant.vx *= 0.15; }
    else if (!isSolid(state, ngx, s.gy)) { ny = ant.y; ant.vy *= 0.15; }
    else { nx = ant.x; ny = ant.y; ant.vx *= 0.05; ant.vy *= 0.05; ant.stuck++; }
  } else ant.stuck = 0;

  if (ant.stuck > 8) { antUnstick(state, ant, s.gx, s.gy); ant.stuck = 0; }

  ant.x = Math.max(FRAME + CELL, Math.min(W - FRAME - CELL, nx));
  const minY = SURFACE_PX - CELL * 5;
  ant.y = Math.max(minY, Math.min(H - FRAME * 2.5 - CELL, ny));
  if (ant.y < SURFACE_PX - CELL * 3 && !ant._atSurface()) {
    ant.vy = Math.max(ant.vy, 0.2);
  }
}

function antUpdate(state, ant) {
  const s = antSense(state, ant);
  antThink(state, ant, s);
  antAct(state, ant, s);
}

// =====================================================================
//  CORE TICK
// =====================================================================

function singleTick(state) {
  for (const ant of state.ants) antUpdate(state, ant);
  if (state.frame % 3 === 0) gravity(state);
  if (state.frame % 8 === 0) phDecay(state);
  // Remove dead ants
  for (let i = state.ants.length - 1; i >= 0; i--) {
    if (state.ants[i].energy <= 0) state.ants.splice(i, 1);
  }

  // Queen spawns
  if (state.hasQueen && state.frame % 1800 === 0 && state.ants.length < 60) {
    const queen = state.ants.find(a => a.isQueen);
    if (queen) {
      state.ants.push(createAnt(queen.x + (Math.random() - 0.5) * 10, queen.y));
    }
  }

  // AI awareness pass
  if (state.frame - state.lastAITick >= AI_INTERVAL) {
    aiAwarenessPass(state);
    state.lastAITick = state.frame;
  }

  state.frame++;
  state.simDay = 1 + (state.frame / 3600) | 0;

  if (state.frame % 250 === 0) detectChambers(state);
}

// =====================================================================
//  PUBLIC API
// =====================================================================

/**
 * createColony() - Initialize a fresh colony, returns state object
 */
function createColony() {
  nextId = 1; // reset ID counter

  const state = {
    grid: null,
    phTrail: null,
    phFood: null,
    phDig: null,
    ants: [],
    foods: [],
    chambers: [],
    frame: 0,
    totalDug: 0,
    simDay: 1,
    hasQueen: false,
    tunnelPlan: createTunnelPlan(),
    sandNoise: null,
    lastAITick: 0,
    terrainDirty: true,
    narration: '',
  };

  state.sandNoise = genSandNoise();
  initTerrain(state);
  tunnelPlanInit(state.tunnelPlan);

  // Drop initial ants (8 workers + 1 queen)
  for (let i = 0; i < 8; i++) {
    state.ants.push(createAnt(Math.random() * (W - 80) + 40, (SURFACE - 1) * CELL));
  }
  const queen = createAnt(W / 2, (SURFACE - 1) * CELL, true);
  state.ants.push(queen);
  state.hasQueen = true;

  return state;
}

/**
 * tickColony(state, numTicks) - Run N simulation ticks, returns updated state
 */
function tickColony(state, numTicks) {
  const n = numTicks || 1;
  for (let i = 0; i < n; i++) {
    singleTick(state);
  }
  return state;
}

/**
 * dropAnts(state, n) - Add n ants to the colony
 */
function dropAnts(state, n) {
  for (let i = 0; i < n; i++) {
    state.ants.push(createAnt(Math.random() * (W - 80) + 40, (SURFACE - 1) * CELL));
  }
  if (!state.hasQueen && state.ants.length > 0) {
    const q = createAnt(W / 2, (SURFACE - 1) * CELL, true);
    state.ants.push(q);
    state.hasQueen = true;
  }
}

/**
 * dropFood(state) - Add food at a random surface position
 */
function dropFood(state) {
  state.foods.push({
    x: Math.random() * (W - 60) + 30,
    y: SURFACE_PX - CELL * 2,
    amount: 4 + (Math.random() * 5) | 0
  });
}

/**
 * serializeState(state) - Convert state to JSON-safe object for storage
 */
// Base64 encode/decode for typed arrays — reduces serialized size by ~10x
function uint8ToBase64(uint8) {
  return Buffer.from(uint8).toString('base64');
}
function base64ToUint8(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
function float32ToBase64(f32) {
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
}
function base64ToFloat32(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// Sparse encoding for pheromone arrays — most values are zero
// Format: {length, entries: [[index, value], ...]}
function sparseEncodeFloat32(f32) {
  const entries = [];
  for (let i = 0; i < f32.length; i++) {
    if (f32[i] > 0.003) entries.push([i, Math.round(f32[i] * 1000) / 1000]);
  }
  return { length: f32.length, entries };
}
function sparseDecodeFloat32(sparse) {
  const f32 = new Float32Array(sparse.length);
  for (const [i, v] of sparse.entries) {
    f32[i] = v;
  }
  return f32;
}

function serializeState(state) {
  // Serialize ants (strip methods and circular refs like tandemTarget/tandemLeader)
  const serializedAnts = state.ants.map(ant => {
    const a = {};
    const skipKeys = new Set(['tandemTarget', 'tandemLeader', 'antennateTarget', '_gx', '_gy', '_depthR', '_atSurface', '_currentSpeed']);
    for (const key of Object.keys(ant)) {
      if (skipKeys.has(key)) continue;
      if (typeof ant[key] === 'function') continue;
      a[key] = ant[key];
    }
    // Store tandem references by ID
    a.tandemTargetId = ant.tandemTarget ? ant.tandemTarget.id : null;
    a.tandemLeaderId = ant.tandemLeader ? ant.tandemLeader.id : null;
    a.antennateTargetId = ant.antennateTarget ? ant.antennateTarget.id : null;
    return a;
  });

  return {
    grid: uint8ToBase64(state.grid),
    phTrail: sparseEncodeFloat32(state.phTrail),
    phFood: sparseEncodeFloat32(state.phFood),
    phDig: sparseEncodeFloat32(state.phDig),
    ants: serializedAnts,
    foods: state.foods.map(f => ({ x: f.x, y: f.y, amount: f.amount })),
    chambers: state.chambers.map(c => ({ x: c.x, y: c.y, size: c.size })),
    frame: state.frame,
    totalDug: state.totalDug,
    simDay: state.simDay,
    hasQueen: state.hasQueen,
    tunnelPlan: {
      entrances: state.tunnelPlan.entrances.slice(),
      mainShaftX: state.tunnelPlan.mainShaftX,
      mainShaftX2: state.tunnelPlan.mainShaftX2,
      galleries: state.tunnelPlan.galleries.map(g => ({ depth: g.depth, leftExtent: g.leftExtent, rightExtent: g.rightExtent, complete: g.complete })),
      digFrontier: state.tunnelPlan.digFrontier.slice(),
      shaftBottom: state.tunnelPlan.shaftBottom,
      shaftBottom2: state.tunnelPlan.shaftBottom2,
      initialized: state.tunnelPlan.initialized
    },
    // sandNoise is deterministic — regenerated on deserialization
    lastAITick: state.lastAITick,
    terrainDirty: state.terrainDirty,
    narration: state.narration,
    nextId: nextId
  };
}

/**
 * deserializeState(data) - Reconstruct state from serialized data
 */
function deserializeState(data) {
  nextId = data.nextId || 1;

  const state = {
    grid: typeof data.grid === 'string' ? base64ToUint8(data.grid) : new Uint8Array(data.grid),
    phTrail: data.phTrail && data.phTrail.entries ? sparseDecodeFloat32(data.phTrail) : (typeof data.phTrail === 'string' ? base64ToFloat32(data.phTrail) : new Float32Array(data.phTrail)),
    phFood: data.phFood && data.phFood.entries ? sparseDecodeFloat32(data.phFood) : (typeof data.phFood === 'string' ? base64ToFloat32(data.phFood) : new Float32Array(data.phFood)),
    phDig: data.phDig && data.phDig.entries ? sparseDecodeFloat32(data.phDig) : (typeof data.phDig === 'string' ? base64ToFloat32(data.phDig) : new Float32Array(data.phDig)),
    ants: [],
    foods: data.foods.map(f => ({ x: f.x, y: f.y, amount: f.amount })),
    chambers: data.chambers.map(c => ({ x: c.x, y: c.y, size: c.size })),
    frame: data.frame,
    totalDug: data.totalDug,
    simDay: data.simDay,
    hasQueen: data.hasQueen,
    tunnelPlan: {
      entrances: data.tunnelPlan.entrances.slice(),
      mainShaftX: data.tunnelPlan.mainShaftX,
      mainShaftX2: data.tunnelPlan.mainShaftX2,
      galleries: data.tunnelPlan.galleries.map(g => ({ depth: g.depth, leftExtent: g.leftExtent, rightExtent: g.rightExtent, complete: g.complete })),
      digFrontier: data.tunnelPlan.digFrontier.slice(),
      shaftBottom: data.tunnelPlan.shaftBottom,
      shaftBottom2: data.tunnelPlan.shaftBottom2,
      initialized: data.tunnelPlan.initialized
    },
    sandNoise: data.sandNoise ? (typeof data.sandNoise === 'string' ? base64ToFloat32(data.sandNoise) : new Float32Array(data.sandNoise)) : genSandNoiseArray(),
    lastAITick: data.lastAITick,
    terrainDirty: data.terrainDirty !== undefined ? data.terrainDirty : true,
    narration: data.narration || '',
  };

  // Reconstruct ants with methods
  const antMap = {};
  for (const ad of data.ants) {
    const ant = createAnt(ad.x, ad.y, ad.isQueen);
    // Overwrite all properties from serialized data
    for (const key of Object.keys(ad)) {
      if (key === 'tandemTargetId' || key === 'tandemLeaderId' || key === 'antennateTargetId') continue;
      if (typeof ad[key] !== 'function') {
        ant[key] = ad[key];
      }
    }
    // Restore threshold object
    if (ad.threshold) ant.threshold = { dig: ad.threshold.dig, forage: ad.threshold.forage, explore: ad.threshold.explore };
    // Restore memory array
    if (ad.memory) ant.memory = ad.memory.slice();
    antMap[ant.id] = ant;
    state.ants.push(ant);
  }

  // Re-link tandem references
  for (const ad of data.ants) {
    const ant = antMap[ad.id];
    if (!ant) continue;
    ant.tandemTarget = ad.tandemTargetId ? (antMap[ad.tandemTargetId] || null) : null;
    ant.tandemLeader = ad.tandemLeaderId ? (antMap[ad.tandemLeaderId] || null) : null;
    ant.antennateTarget = ad.antennateTargetId ? (antMap[ad.antennateTargetId] || null) : null;
  }

  return state;
}

/**
 * getColonySnapshot(state) - Compact summary for Claude API
 */
function getColonySnapshot(state) {
  const roleCounts = {};
  const stateCounts = {};
  let totalEnergy = 0;
  let totalExperience = 0;
  const thoughts = [];

  for (const ant of state.ants) {
    roleCounts[ant.role] = (roleCounts[ant.role] || 0) + 1;
    const stName = ST_NAMES[ant.state] || 'Unknown';
    stateCounts[stName] = (stateCounts[stName] || 0) + 1;
    totalEnergy += ant.energy;
    totalExperience += ant.experience;
    if (ant.lastThought && state.frame - ant.lastThoughtTime < 300) {
      thoughts.push({ name: ant.name, thought: ant.lastThought });
    }
  }

  const tp = state.tunnelPlan;
  const tunnelPct = (state.totalDug / ((ROWS - SURFACE) * COLS) * 100).toFixed(1);

  // Calculate average depth of ants underground
  let undergroundAnts = 0;
  let totalDepth = 0;
  for (const ant of state.ants) {
    if (!ant._atSurface()) {
      undergroundAnts++;
      totalDepth += ant._depthR();
    }
  }

  return {
    population: state.ants.length,
    hasQueen: state.hasQueen,
    simDay: state.simDay,
    frame: state.frame,
    roles: roleCounts,
    states: stateCounts,
    avgEnergy: state.ants.length > 0 ? Math.round(totalEnergy / state.ants.length) : 0,
    avgExperience: state.ants.length > 0 ? Math.round(totalExperience / state.ants.length) : 0,
    tunnelPercent: parseFloat(tunnelPct),
    totalDug: state.totalDug,
    chambers: state.chambers.length,
    chamberDetails: state.chambers.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), size: c.size })),
    foodSources: state.foods.length,
    totalFood: state.foods.reduce((s, f) => s + f.amount, 0),
    tunnel: {
      mainShaftX: tp.mainShaftX,
      mainShaftX2: tp.mainShaftX2,
      shaftBottom: tp.shaftBottom,
      shaftBottom2: tp.shaftBottom2,
      entrances: tp.entrances.length,
      galleries: tp.galleries.map(g => ({
        depth: g.depth,
        width: g.rightExtent - g.leftExtent,
        complete: g.complete
      })),
      frontierSize: tp.digFrontier.length
    },
    undergroundAnts: undergroundAnts,
    avgDepth: undergroundAnts > 0 ? parseFloat((totalDepth / undergroundAnts).toFixed(2)) : 0,
    recentThoughts: thoughts.slice(0, 5),
    narration: state.narration
  };
}

/**
 * applyDirective(state, directive) - Apply Claude's strategic directive to colony
 *
 * directive can contain:
 *   .focusRole: 'digger'|'forager'|'explorer' - shift colony focus
 *   .digTarget: {gx, gy, type} - add a dig target to the frontier
 *   .narration: string - Claude's narrative text for the viewer
 *   .spawnAnts: number - add N new ants
 *   .dropFood: boolean - place food
 *   .adjustThresholds: {dig, forage, explore} - shift colony thresholds
 *   .prioritizeShaft: boolean - prioritize main shaft extension
 *   .prioritizeGalleries: boolean - prioritize gallery extension
 */
function applyDirective(state, directive) {
  if (!directive) return state;

  // Narration
  if (directive.narration) {
    state.narration = directive.narration;
  }

  // Spawn ants
  if (directive.spawnAnts && directive.spawnAnts > 0) {
    dropAnts(state, directive.spawnAnts);
  }

  // Drop food
  if (directive.dropFood) {
    dropFood(state);
  }

  // Focus role — shift idle ants toward the desired role
  if (directive.focusRole) {
    const target = directive.focusRole;
    for (const ant of state.ants) {
      if (ant.isQueen) continue;
      if (ant.role === 'idle' || ant.state === ST.WANDER) {
        if (target === 'digger') {
          ant.threshold.dig *= 0.5; // lower threshold = more likely to dig
          if (Math.random() < 0.6) {
            ant.role = 'digger';
            ant.state = ST.ENTER;
            const entrance = tunnelPlanNearestEntrance(state.tunnelPlan, ant._gx());
            ant.targetX = entrance ? entrance.gx * CELL : state.tunnelPlan.mainShaftX * CELL;
          }
        } else if (target === 'forager') {
          ant.threshold.forage *= 0.5;
          if (Math.random() < 0.5) {
            ant.role = 'forager';
            ant.state = ST.FORAGE;
          }
        } else if (target === 'explorer') {
          ant.threshold.explore *= 0.5;
          if (Math.random() < 0.5) {
            ant.role = 'explorer';
            ant.state = ST.EXPLORE;
          }
        }
      }
    }
  }

  // Adjust thresholds globally
  if (directive.adjustThresholds) {
    const adj = directive.adjustThresholds;
    for (const ant of state.ants) {
      if (ant.isQueen) continue;
      if (adj.dig !== undefined) ant.threshold.dig = Math.max(0.01, Math.min(0.99, ant.threshold.dig + adj.dig));
      if (adj.forage !== undefined) ant.threshold.forage = Math.max(0.01, Math.min(0.99, ant.threshold.forage + adj.forage));
      if (adj.explore !== undefined) ant.threshold.explore = Math.max(0.01, Math.min(0.99, ant.threshold.explore + adj.explore));
    }
  }

  // Add dig target
  if (directive.digTarget) {
    const dt = directive.digTarget;
    state.tunnelPlan.digFrontier.push({
      gx: dt.gx, gy: dt.gy,
      type: dt.type || 'gallery',
      angle: dt.angle || 0,
      priority: dt.priority || 8
    });
  }

  // Prioritize shaft
  if (directive.prioritizeShaft) {
    for (const f of state.tunnelPlan.digFrontier) {
      if (f.type === 'shaft') f.priority += 5;
    }
  }

  // Prioritize galleries
  if (directive.prioritizeGalleries) {
    for (const f of state.tunnelPlan.digFrontier) {
      if (f.type === 'gallery') f.priority += 5;
    }
  }

  return state;
}

/**
 * getViewerState(state) - Full state needed by browser viewer
 * Returns grid, ants, tunnelPlan, narration, foods, chambers, etc.
 */
function getViewerState(state) {
  return {
    grid: uint8ToBase64(state.grid),
    ants: state.ants.map(ant => ({
      id: ant.id,
      x: ant.x, y: ant.y,
      px: ant.px, py: ant.py,
      vx: ant.vx, vy: ant.vy,
      state: ant.state,
      energy: ant.energy,
      carrying: ant.carrying,
      carryingSand: ant.carryingSand,
      isQueen: ant.isQueen,
      name: ant.name,
      role: ant.role,
      size: ant.size,
      hue: ant.hue,
      legT: ant.legT,
      antT: ant.antT,
      bodyBob: ant.bodyBob,
      heading: ant.heading,
      isPaused: ant.isPaused,
      lastThought: ant.lastThought,
      lastThoughtTime: ant.lastThoughtTime,
      antennateTimer: ant.antennateTimer,
      tandemTargetId: ant.tandemTarget ? ant.tandemTarget.id : null,
    })),
    foods: state.foods,
    chambers: state.chambers,
    tunnelPlan: {
      entrances: state.tunnelPlan.entrances,
      mainShaftX: state.tunnelPlan.mainShaftX,
      mainShaftX2: state.tunnelPlan.mainShaftX2,
      galleries: state.tunnelPlan.galleries,
      shaftBottom: state.tunnelPlan.shaftBottom,
      shaftBottom2: state.tunnelPlan.shaftBottom2,
      initialized: state.tunnelPlan.initialized
    },
    frame: state.frame,
    totalDug: state.totalDug,
    simDay: state.simDay,
    hasQueen: state.hasQueen,
    terrainDirty: state.terrainDirty,
    narration: state.narration,
    insight: state.insight || '',
    directive: state.currentDirective || null,
    tokenUsage: state.tokenUsage || null,
    roleCounts: (function() {
      const rc = { digger: 0, forager: 0, explorer: 0, idle: 0 };
      for (const ant of state.ants) {
        if (ant.isQueen) continue;
        if (rc[ant.role] !== undefined) rc[ant.role]++;
        else rc.idle++;
      }
      return rc;
    })(),

    // Constants the viewer needs
    constants: {
      W: W, H: H, CELL: CELL, COLS: COLS, ROWS: ROWS,
      SURFACE: SURFACE, SURFACE_PX: SURFACE_PX, FRAME: FRAME,
      SAND_R: SAND_R, SAND_G: SAND_G, SAND_B: SAND_B
    }
  };
}

// =====================================================================
//  MODULE EXPORTS
// =====================================================================

module.exports = {
  // Primary API
  createColony,
  tickColony,
  serializeState,
  deserializeState,
  getColonySnapshot,
  applyDirective,
  getViewerState,

  // Secondary helpers
  dropAnts,
  dropFood,
  detectChambers,

  // Constants (useful for viewer or tests)
  W, H, CELL, COLS, ROWS, SURFACE, SURFACE_PX, FRAME,
  PX_PER_CM, ANT_BODY_PX, BASE_SPEED, LOADED_SPEED, TANDEM_SPEED,
  AI_INTERVAL, SAND_R, SAND_G, SAND_B,
  ST, ST_NAMES
};
