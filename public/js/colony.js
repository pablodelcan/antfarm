// =====================================================================
//  ANTFARM v10 — Colony: creation, tick loop, spawning, serialization
// =====================================================================

'use strict';

AF.colony = {};

// ═══════════════════════════════════════════════════════════════════
//  CREATE — fresh colony
// ═══════════════════════════════════════════════════════════════════

AF.colony.create = function() {
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
    entranceX: -1,
    terrainDirty: true,

    // AI directive state
    narration: '',
    insight: '',
    directive: null,
    tokenUsage: null,
    digPriority: 7,

    // AI-tunable behavioral parameters (adjusted by hourly cron)
    tuning: {
      restThreshold: 20,
      explorationBias: 0.3,
      forageRadius: 200,
      branchingChance: 0.15,
      chamberSizeTarget: 60,
      antMaxEnergy: 100,
      queenSpawnRate: 1800,
      sandCarryMax: 5,
    },

    // Colony intelligence
    colonyGoals: null, // initialized by behavior.updateColonyGoals
  };

  // Generate terrain
  AF.terrain.init(state);

  // Set entrance near center
  state.entranceX = Math.round(AF.COLS * 0.45 + Math.random() * AF.COLS * 0.1);

  // Spawn initial workers
  const entrancePx = state.entranceX * AF.CELL + AF.CELL / 2;
  for (let i = 0; i < 8; i++) {
    const ant = AF.ant.create(
      entrancePx + (Math.random() - 0.5) * 40,
      AF.SURFACE_PX - AF.CELL * 2 + Math.random() * AF.CELL,
      false
    );
    state.ants.push(ant);
  }

  // Spawn queen
  const queen = AF.ant.create(entrancePx, AF.SURFACE_PX - AF.CELL, true);
  state.ants.push(queen);
  state.hasQueen = true;

  return state;
};

// ═══════════════════════════════════════════════════════════════════
//  TICK — single simulation step
// ═══════════════════════════════════════════════════════════════════

AF.colony.tick = function(state) {
  state.frame++;

  // Colony intelligence: update goals every 120 frames (~2 seconds)
  if (state.frame % 120 === 0) {
    AF.behavior.updateColonyGoals(state);
  }

  // Pheromone decay every 8 frames
  if (state.frame % 8 === 0) {
    AF.pheromones.decay(state);
  }

  // Gravity every 4 frames
  if (state.frame % 4 === 0) {
    AF.terrain.gravity(state);
  }

  // Update all ants
  for (let i = state.ants.length - 1; i >= 0; i--) {
    const ant = state.ants[i];
    AF.behavior.update(state, ant);

    // Remove dead ants
    if (ant._dead) {
      state.ants.splice(i, 1);
      if (ant.isQueen) state.hasQueen = false;
    }
  }

  // Queen spawns new ant (rate tunable by AI cron)
  const spawnRate = (state.tuning && state.tuning.queenSpawnRate) || 1800;
  if (state.frame % spawnRate === 0 && state.hasQueen && state.ants.length < 60) {
    const queen = state.ants.find(a => a.isQueen);
    if (queen) {
      const baby = AF.ant.create(
        queen.x + (Math.random() - 0.5) * 20,
        queen.y - AF.CELL,
        false
      );
      state.ants.push(baby);
    }
  }

  // Advance day every 5 simulated minutes (18000 frames)
  if (state.frame % 18000 === 0) {
    state.simDay++;
  }

  // Chamber detection every 300 frames
  if (state.frame % 300 === 0) {
    AF.colony.detectChambers(state);
  }

  // Clean up depleted food
  state.foods = state.foods.filter(f => f.amount > 0);
};

// ═══════════════════════════════════════════════════════════════════
//  CHAMBER DETECTION
// ═══════════════════════════════════════════════════════════════════

AF.colony.detectChambers = function(state) {
  const { COLS, ROWS, SURFACE, CELL } = AF;
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
        if (n >= 40) {
          state.chambers.push({ x: (sx / n) * CELL, y: (sy / n) * CELL, size: n });
        }
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
//  DROP — add ants/food externally
// ═══════════════════════════════════════════════════════════════════

AF.colony.dropAnts = function(state, n) {
  for (let i = 0; i < n; i++) {
    const ant = AF.ant.create(
      AF.W * 0.3 + Math.random() * AF.W * 0.4,
      AF.SURFACE_PX - AF.CELL * 2,
      false
    );
    ant.state = AF.ST.IDLE;
    ant.vy = 0;
    state.ants.push(ant);
  }
};

AF.colony.dropFood = function(state) {
  // Drop food on the surface, not underground
  const cx = AF.W * 0.2 + Math.random() * AF.W * 0.6;
  const cy = AF.SURFACE_PX - AF.CELL * 2;
  state.foods.push({ x: cx, y: cy, amount: 8 + (Math.random() * 8) | 0 });
};

// ═══════════════════════════════════════════════════════════════════
//  APPLY DIRECTIVE — from Claude AI
// ═══════════════════════════════════════════════════════════════════

AF.colony.applyDirective = function(state, directive) {
  if (!directive) return;

  // Store for display
  state.narration = directive.narration || state.narration;
  state.insight = directive.insight || state.insight;
  state.directive = directive;
  if (directive.tokenUsage) state.tokenUsage = directive.tokenUsage;

  // Adjust dig priority based on focus
  switch (directive.focus) {
    case 'extend_shaft':  state.digPriority = 9; break;
    case 'extend_gallery': state.digPriority = 7; break;
    case 'dig_chamber':   state.digPriority = 6; break;
    case 'explore':       state.digPriority = 3; break;
    case 'forage':        state.digPriority = 2; break;
    case 'rest':          state.digPriority = 1; break;
    default:              state.digPriority = 5; break;
  }

  // Apply tuning parameters from hourly cron evolution
  if (directive.tuning) {
    const t = directive.tuning;
    if (t.digPriority != null) state.digPriority = AF.clamp(t.digPriority, 1, 10);
    if (t.restThreshold != null) state.tuning.restThreshold = AF.clamp(t.restThreshold, 0, 100);
    if (t.explorationBias != null) state.tuning.explorationBias = AF.clamp(t.explorationBias, 0, 1);
    if (t.forageRadius != null) state.tuning.forageRadius = AF.clamp(t.forageRadius, 50, 400);
    if (t.branchingChance != null) state.tuning.branchingChance = AF.clamp(t.branchingChance, 0, 1);
    if (t.chamberSizeTarget != null) state.tuning.chamberSizeTarget = AF.clamp(t.chamberSizeTarget, 40, 200);
    if (t.antMaxEnergy != null) state.tuning.antMaxEnergy = AF.clamp(t.antMaxEnergy, 50, 200);
    if (t.queenSpawnRate != null) state.tuning.queenSpawnRate = AF.clamp(t.queenSpawnRate, 600, 5400);
    if (t.sandCarryMax != null) state.tuning.sandCarryMax = AF.clamp(t.sandCarryMax, 1, 10);
  }

  // Role shifts: nudge some ants between states
  if (directive.role_shift) {
    const rs = directive.role_shift;
    let toDigger = rs.idle_to_digger || 0;
    let toForager = rs.idle_to_forager || 0;
    let toExplorer = rs.idle_to_explorer || 0;

    for (const ant of state.ants) {
      if (ant.isQueen) continue;
      if (ant.state === AF.ST.IDLE || ant.state === AF.ST.REST) {
        if (toDigger > 0) {
          ant.state = AF.ST.ENTER; ant.stateTimer = 0; toDigger--;
        } else if (toForager > 0) {
          ant.state = AF.ST.FORAGE; ant.stateTimer = 0; toForager--;
        } else if (toExplorer > 0) {
          ant.state = AF.ST.EXPLORE; ant.stateTimer = 0; toExplorer--;
        }
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
//  SNAPSHOT — compact summary for Claude AI
// ═══════════════════════════════════════════════════════════════════

AF.colony.getSnapshot = function(state) {
  const roles = { digger: 0, forager: 0, explorer: 0, idle: 0 };
  let avgEnergy = 0, stuckCount = 0;
  for (const ant of state.ants) {
    if (ant.isQueen) continue;
    switch (ant.role) {
      case 'digger': roles.digger++; break;
      case 'forager': roles.forager++; break;
      case 'explorer': roles.explorer++; break;
      default: roles.idle++; break;
    }
    avgEnergy += ant.energy;
    if (ant.stuck > 3) stuckCount++;
  }
  const pop = state.ants.filter(a => !a.isQueen).length;
  avgEnergy = pop > 0 ? (avgEnergy / pop) | 0 : 0;

  const dug = ((state.totalDug / ((AF.ROWS - AF.SURFACE) * AF.COLS)) * 100).toFixed(1);

  return {
    day: state.simDay,
    pop: pop,
    dug: dug + '%',
    roles: roles,
    food: state.foods.reduce((s, f) => s + f.amount, 0),
    chambers: state.chambers.length,
    avgEnergy: avgEnergy,
    stuck: stuckCount,
  };
};

// ═══════════════════════════════════════════════════════════════════
//  SERIALIZE / DESERIALIZE — checkpoint for server storage
// ═══════════════════════════════════════════════════════════════════

AF.colony.serialize = function(state) {
  // Grid as base64
  const gridB64 = _uint8ToBase64(state.grid);

  // Pheromones as sparse encoding (only non-zero entries)
  const phTrail = _sparseEncode(state.phTrail);
  const phFood = _sparseEncode(state.phFood);
  const phDig = _sparseEncode(state.phDig);

  // Ants as plain objects
  const ants = state.ants.map(a => ({
    id: a.id, x: +a.x.toFixed(1), y: +a.y.toFixed(1),
    vx: +a.vx.toFixed(3), vy: +a.vy.toFixed(3),
    state: a.state, prevState: a.prevState,
    energy: +a.energy.toFixed(1), age: a.age,
    isQueen: a.isQueen,
    carrying: a.carrying, carryingSand: a.carryingSand,
    maxSandCarry: a.maxSandCarry,
    heading: +a.heading.toFixed(3), digAngle: +a.digAngle.toFixed(3),
    stuck: a.stuck, digCD: a.digCD, digCount: a.digCount,
    stateTimer: a.stateTimer, timeSinceRest: a.timeSinceRest,
    role: a.role, name: a.name,
    size: +a.size.toFixed(2), hue: +a.hue.toFixed(1),
  }));

  return {
    v: 10,
    grid: gridB64,
    phTrail, phFood, phDig,
    ants, foods: state.foods,
    chambers: state.chambers,
    frame: state.frame, totalDug: state.totalDug, simDay: state.simDay,
    hasQueen: state.hasQueen, entranceX: state.entranceX,
    narration: state.narration, insight: state.insight,
    digPriority: state.digPriority,
    tuning: state.tuning,
    colonyGoals: state.colonyGoals,
    nextId: AF.ant.getNextId(),
  };
};

AF.colony.deserialize = function(data) {
  const state = {
    grid: _base64ToUint8(data.grid),
    phTrail: _sparseDecode(data.phTrail, AF.COLS * AF.ROWS),
    phFood: _sparseDecode(data.phFood, AF.COLS * AF.ROWS),
    phDig: _sparseDecode(data.phDig, AF.COLS * AF.ROWS),
    ants: [],
    foods: data.foods || [],
    chambers: data.chambers || [],
    frame: data.frame || 0,
    totalDug: data.totalDug || 0,
    simDay: data.simDay || 1,
    hasQueen: data.hasQueen || false,
    entranceX: data.entranceX != null ? data.entranceX : -1,
    terrainDirty: true,
    narration: data.narration || '',
    insight: data.insight || '',
    directive: null,
    tokenUsage: null,
    digPriority: data.digPriority || 7,
    tuning: data.tuning || {
      restThreshold: 20,
      explorationBias: 0.3,
      forageRadius: 200,
      branchingChance: 0.15,
      chamberSizeTarget: 60,
      antMaxEnergy: 100,
      queenSpawnRate: 1800,
      sandCarryMax: 5,
    },
    colonyGoals: data.colonyGoals || null,
  };

  // Restore ant ID counter
  if (data.nextId) AF.ant.resetIdCounter(data.nextId);

  // Reconstruct ants
  for (const a of (data.ants || [])) {
    const ant = AF.ant.create(a.x, a.y, a.isQueen);
    // Override with saved values
    Object.assign(ant, {
      id: a.id, vx: a.vx || 0, vy: a.vy || 0,
      state: a.state, prevState: a.prevState || a.state,
      energy: a.energy, age: a.age || 0,
      carrying: a.carrying, carryingSand: a.carryingSand || 0,
      maxSandCarry: a.maxSandCarry || 5,
      heading: a.heading || 0, digAngle: a.digAngle || Math.PI * 0.5,
      stuck: a.stuck || 0, digCD: a.digCD || 0, digCount: a.digCount || 0,
      stateTimer: a.stateTimer || 0, timeSinceRest: a.timeSinceRest || 0,
      role: a.role || 'idle', name: a.name,
      size: a.size, hue: a.hue,
    });
    state.ants.push(ant);
  }

  return state;
};

// ── Role counts (for HUD) ──

AF.colony.getRoleCounts = function(state) {
  const counts = { digger: 0, forager: 0, explorer: 0, idle: 0, resting: 0 };
  for (const ant of state.ants) {
    if (ant.isQueen) continue;
    const r = ant.role;
    if (r in counts) counts[r]++;
    else counts.idle++;
  }
  return counts;
};

// ═══════════════════════════════════════════════════════════════════
//  ENCODING HELPERS
// ═══════════════════════════════════════════════════════════════════

function _uint8ToBase64(arr) {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function _base64ToUint8(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function _sparseEncode(float32) {
  const entries = [];
  for (let i = 0; i < float32.length; i++) {
    if (float32[i] > 0.003) {
      entries.push([i, +(float32[i].toFixed(4))]);
    }
  }
  return { length: float32.length, entries };
}

function _sparseDecode(data, defaultLen) {
  if (!data) return new Float32Array(defaultLen);
  const arr = new Float32Array(data.length || defaultLen);
  if (data.entries) {
    for (const [i, v] of data.entries) arr[i] = v;
  }
  return arr;
}
