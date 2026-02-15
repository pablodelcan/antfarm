// =====================================================================
//  ANTFARM v11 — Colony: creation, tick loop, brood, serialization
// =====================================================================

'use strict';

AF.colony = {};

let _nextBroodId = 1;

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
    brood: [],            // eggs, larvae, pupae
    foodStores: [],       // underground food deposits in chambers
    frame: 0,
    totalDug: 0,
    simDay: 1,
    hasQueen: false,
    queenUnderground: false,
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
      nursePriority: 5,     // how many nurses colony wants (1-10)
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

  // Ensure brood/foodStores arrays exist (backward compat)
  if (!state.brood) state.brood = [];
  if (!state.foodStores) state.foodStores = [];

  // Colony intelligence: update goals every 120 frames (~2 seconds)
  if (state.frame % 120 === 0) {
    AF.behavior.updateColonyGoals(state);
  }

  // Re-apply AI role_shift every 300 frames (~5 seconds) to keep nudging idle ants
  if (state.frame % 300 === 0 && state.directive && state.directive.role_shift) {
    AF.colony._applyRoleShift(state, state.directive.role_shift);
  }

  // Pheromone decay every 8 frames
  if (state.frame % 8 === 0) {
    AF.pheromones.decay(state);
  }

  // Gravity every 4 frames
  if (state.frame % 4 === 0) {
    AF.terrain.gravity(state);
  }

  // Keep entrance clear of drifted sand (every 8 frames)
  if (state.frame % 8 === 0) {
    AF.terrain.clearEntrance(state);
  }

  // Update all ants (including maturity aging)
  for (let i = state.ants.length - 1; i >= 0; i--) {
    const ant = state.ants[i];
    AF.behavior.update(state, ant);

    // Age-based maturity increase (young ants mature over time)
    if (!ant.isQueen && ant.maturity < 1.0) {
      ant.maturity = Math.min(1.0, ant.maturity + 0.00003); // full maturity ~33000 frames (~9 min)
    }

    // Remove dead ants — emit death event for visual effects
    if (ant._dead) {
      // Store death position for particle effects
      if (!state._deaths) state._deaths = [];
      state._deaths.push({ x: ant.x, y: ant.y, name: ant.name });
      state.ants.splice(i, 1);
      if (ant.isQueen) state.hasQueen = false;
    }
  }

  // ── Queen lays eggs (realistic brood reproduction) ──
  const spawnRate = (state.tuning && state.tuning.queenSpawnRate) || 1800;
  const totalPop = state.ants.length + state.brood.length;
  if (state.frame % spawnRate === 0 && state.hasQueen && totalPop < 80) {
    const queen = state.ants.find(a => a.isQueen);
    if (queen) {
      // Queen lays an egg at her location
      const foodAvailable = state.foodStores.reduce((s, f) => s + f.amount, 0)
                          + state.foods.reduce((s, f) => s + f.amount, 0);
      // Need some food in colony to lay eggs (starvation prevents reproduction)
      if (foodAvailable > 0 || state.brood.length < 3) {
        // Place egg in open space near queen
        let eggX = queen.x + (Math.random() - 0.5) * 8;
        let eggY = queen.y + (Math.random() - 0.5) * 6;
        const egx = (eggX / AF.CELL) | 0;
        const egy = (eggY / AF.CELL) | 0;
        // If placement is inside solid terrain, use queen's position
        if (AF.terrain.isSolid(state, egx, egy)) {
          eggX = queen.x;
          eggY = queen.y;
        }
        state.brood.push({
          id: _nextBroodId++,
          stage: AF.BROOD.EGG,
          x: eggX,
          y: eggY,
          age: 0,
          fed: 0,       // feedings received (larvae need AF.LARVA_FEEDINGS_NEEDED)
        });
      }
    }
  }

  // ── Brood development ──
  for (let i = state.brood.length - 1; i >= 0; i--) {
    const b = state.brood[i];
    b.age++;

    if (b.stage === AF.BROOD.EGG && b.age >= AF.BROOD_TIME.EGG) {
      // Egg hatches into larva
      b.stage = AF.BROOD.LARVA;
      b.age = 0;
      b.fed = 0;
    } else if (b.stage === AF.BROOD.LARVA) {
      // Larva needs feeding AND time to pupate
      if (b.age >= AF.BROOD_TIME.LARVA && b.fed >= AF.LARVA_FEEDINGS_NEEDED) {
        b.stage = AF.BROOD.PUPA;
        b.age = 0;
      }
      // Unfed larvae die after double the normal time
      if (b.age > AF.BROOD_TIME.LARVA * 2 && b.fed < AF.LARVA_FEEDINGS_NEEDED) {
        state.brood.splice(i, 1);
        continue;
      }
    } else if (b.stage === AF.BROOD.PUPA && b.age >= AF.BROOD_TIME.PUPA) {
      // Pupa emerges as adult ant
      const baby = AF.ant.create(b.x, b.y, false);
      baby.maturity = 0.0; // newborns start as young nurses
      baby.energy = 700 + Math.random() * 200;
      state.ants.push(baby);
      state.brood.splice(i, 1);
      continue;
    }
  }

  // Advance day every 5 simulated minutes (18000 frames)
  if (state.frame % 18000 === 0) {
    state.simDay++;
  }

  // Chamber detection every 300 frames (with type assignment)
  if (state.frame % 300 === 0) {
    AF.colony.detectChambers(state);
    AF.colony.assignChamberTypes(state);
  }

  // Clean up depleted food (surface and underground)
  state.foods = state.foods.filter(f => f.amount > 0);
  state.foodStores = state.foodStores.filter(f => f.amount > 0);
};

// ═══════════════════════════════════════════════════════════════════
//  CHAMBER DETECTION
// ═══════════════════════════════════════════════════════════════════

AF.colony.detectChambers = function(state) {
  const { COLS, ROWS, SURFACE, CELL } = AF;
  // Preserve old chamber types for continuity
  const oldTypes = {};
  for (const c of state.chambers) {
    if (c.type && c.type !== AF.CHAMBER_TYPE.GENERAL) {
      const key = Math.round(c.x / CELL) + ',' + Math.round(c.y / CELL);
      oldTypes[key] = c.type;
    }
  }

  state.chambers = [];
  const vis = new Uint8Array(COLS * ROWS);

  for (let y = SURFACE + 5; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      if (!state.grid[i] && !vis[i]) {
        let n = 0, sx = 0, sy = 0;
        let minY = ROWS, maxY = 0;
        const q = [[x, y]]; vis[i] = 1;
        while (q.length && n < 1200) {
          const [cx, cy] = q.pop(); n++; sx += cx; sy += cy;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < COLS && ny >= SURFACE && ny < ROWS) {
              const ni = ny * COLS + nx;
              if (!state.grid[ni] && !vis[ni]) { vis[ni] = 1; q.push([nx, ny]); }
            }
          }
        }
        if (n >= 40) {
          const cx = (sx / n) * CELL;
          const cy = (sy / n) * CELL;
          const key = Math.round(sx / n) + ',' + Math.round(sy / n);
          state.chambers.push({
            x: cx, y: cy, size: n,
            depth: (sy / n) - SURFACE,
            type: oldTypes[key] || AF.CHAMBER_TYPE.GENERAL,
          });
        }
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
//  CHAMBER TYPE ASSIGNMENT — functional purpose based on contents
// ═══════════════════════════════════════════════════════════════════

AF.colony.assignChamberTypes = function(state) {
  if (!state.chambers.length) return;

  const CELL = AF.CELL;
  const queen = state.ants.find(a => a.isQueen);

  // Sort chambers by depth (deepest first)
  const byDepth = state.chambers.slice().sort((a, b) => b.depth - a.depth);

  // Reset types that aren't locked
  for (const c of state.chambers) {
    c._hasQueen = false;
    c._hasBrood = false;
    c._hasFood = false;
  }

  // Check what's in each chamber
  for (const c of state.chambers) {
    const r = Math.sqrt(c.size) * CELL * 0.5;

    // Queen in this chamber?
    if (queen) {
      const qd = Math.hypot(queen.x - c.x, queen.y - c.y);
      if (qd < r + 10) c._hasQueen = true;
    }

    // Brood in this chamber?
    for (const b of state.brood) {
      const bd = Math.hypot(b.x - c.x, b.y - c.y);
      if (bd < r + 10) { c._hasBrood = true; break; }
    }

    // Food stores in this chamber?
    for (const f of state.foodStores) {
      const fd = Math.hypot(f.x - c.x, f.y - c.y);
      if (fd < r + 10) { c._hasFood = true; break; }
    }
  }

  // Assign types based on contents and position
  let hasRoyal = false, hasBrood = false, hasFood = false, hasMidden = false;

  for (const c of byDepth) {
    if (c._hasQueen && !hasRoyal) {
      c.type = AF.CHAMBER_TYPE.ROYAL;
      hasRoyal = true;
    } else if (c._hasBrood && !hasBrood) {
      c.type = AF.CHAMBER_TYPE.BROOD;
      hasBrood = true;
    } else if (c._hasFood && !hasFood) {
      c.type = AF.CHAMBER_TYPE.FOOD;
      hasFood = true;
    }
  }

  // If no royal chamber but queen exists underground, assign deepest large chamber
  if (!hasRoyal && queen && AF.ant.underground(queen)) {
    const candidate = byDepth.find(c => c.size >= 50 && c.type === AF.CHAMBER_TYPE.GENERAL);
    if (candidate) { candidate.type = AF.CHAMBER_TYPE.ROYAL; hasRoyal = true; }
  }

  // Assign midden to shallowest small chamber
  const byShallow = state.chambers.slice().sort((a, b) => a.depth - b.depth);
  for (const c of byShallow) {
    if (c.type === AF.CHAMBER_TYPE.GENERAL && c.size < 120 && !hasMidden) {
      c.type = AF.CHAMBER_TYPE.MIDDEN;
      hasMidden = true;
      break;
    }
  }

  // If brood exists but no brood chamber, assign nearest general chamber to brood
  if (!hasBrood && state.brood.length > 0) {
    const broodCenter = state.brood.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }), { x: 0, y: 0 });
    broodCenter.x /= state.brood.length;
    broodCenter.y /= state.brood.length;
    let best = null, bestDist = Infinity;
    for (const c of state.chambers) {
      if (c.type === AF.CHAMBER_TYPE.GENERAL) {
        const d = Math.hypot(c.x - broodCenter.x, c.y - broodCenter.y);
        if (d < bestDist) { bestDist = d; best = c; }
      }
    }
    if (best) best.type = AF.CHAMBER_TYPE.BROOD;
  }
};

// ═══════════════════════════════════════════════════════════════════
//  HELPER: find chamber by type
// ═══════════════════════════════════════════════════════════════════

AF.colony.findChamber = function(state, type) {
  return state.chambers.find(c => c.type === type) || null;
};

AF.colony.findNearestChamber = function(state, x, y, type) {
  let best = null, bestDist = Infinity;
  for (const c of state.chambers) {
    if (type && c.type !== type) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
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
    case 'nurse':         state.digPriority = 3; break;
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
    if (t.nursePriority != null) state.tuning.nursePriority = AF.clamp(t.nursePriority, 1, 10);
  }

  // Role shifts: nudge some ants between states
  if (directive.role_shift) {
    AF.colony._applyRoleShift(state, directive.role_shift);
  }
};

// Reusable role shift — called both on directive arrival and periodically
AF.colony._applyRoleShift = function(state, rs) {
  if (!rs) return;
  let toDigger = rs.idle_to_digger || 0;
  let toForager = rs.idle_to_forager || 0;
  let toExplorer = rs.idle_to_explorer || 0;
  let toNurse = rs.idle_to_nurse || 0;

  for (const ant of state.ants) {
    if (ant.isQueen) continue;
    if (ant.state === AF.ST.IDLE || ant.state === AF.ST.REST) {
      if (toDigger > 0) {
        ant.state = AF.ST.ENTER; ant.stateTimer = 0; toDigger--;
        AF.ant.setThought(ant, 'AI assigned: dig');
      } else if (toForager > 0) {
        ant.state = AF.ST.FORAGE; ant.stateTimer = 0; toForager--;
        AF.ant.setThought(ant, 'AI assigned: forage');
      } else if (toExplorer > 0) {
        ant.state = AF.ST.EXPLORE; ant.stateTimer = 0; toExplorer--;
        AF.ant.setThought(ant, 'AI assigned: explore');
      } else if (toNurse > 0) {
        ant.state = AF.ST.NURSE; ant.stateTimer = 0; toNurse--;
        AF.ant.setThought(ant, 'AI assigned: nurse');
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
//  SNAPSHOT — compact summary for Claude AI
// ═══════════════════════════════════════════════════════════════════

AF.colony.getSnapshot = function(state) {
  const roles = { digger: 0, forager: 0, explorer: 0, nurse: 0, idle: 0 };
  let avgEnergy = 0, stuckCount = 0;
  for (const ant of state.ants) {
    if (ant.isQueen) continue;
    switch (ant.role) {
      case 'digger': roles.digger++; break;
      case 'forager': roles.forager++; break;
      case 'explorer': roles.explorer++; break;
      case 'nurse': roles.nurse++; break;
      default: roles.idle++; break;
    }
    avgEnergy += ant.energy;
    if (ant.stuck > 3) stuckCount++;
  }
  const pop = state.ants.filter(a => !a.isQueen).length;
  avgEnergy = pop > 0 ? (avgEnergy / pop) | 0 : 0;

  const dug = ((state.totalDug / ((AF.ROWS - AF.SURFACE) * AF.COLS)) * 100).toFixed(1);

  // Brood counts
  const broodCounts = { eggs: 0, larvae: 0, pupae: 0 };
  for (const b of (state.brood || [])) {
    if (b.stage === AF.BROOD.EGG) broodCounts.eggs++;
    else if (b.stage === AF.BROOD.LARVA) broodCounts.larvae++;
    else if (b.stage === AF.BROOD.PUPA) broodCounts.pupae++;
  }

  // Chamber types
  const chamberTypes = {};
  for (const c of state.chambers) {
    const t = c.type || 'general';
    chamberTypes[t] = (chamberTypes[t] || 0) + 1;
  }

  // Food reserves (surface + underground)
  const surfaceFood = state.foods.reduce((s, f) => s + f.amount, 0);
  const storedFood = (state.foodStores || []).reduce((s, f) => s + f.amount, 0);

  return {
    day: state.simDay,
    pop: pop,
    dug: dug + '%',
    roles: roles,
    food: surfaceFood,
    storedFood: storedFood,
    brood: broodCounts,
    chambers: state.chambers.length,
    chamberTypes: chamberTypes,
    queenUnderground: state.queenUnderground || false,
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
    maturity: +(a.maturity || 0).toFixed(3),
    carrying: a.carrying, carryingSand: a.carryingSand,
    carryingFood: a.carryingFood || 0,
    maxSandCarry: a.maxSandCarry,
    heading: +a.heading.toFixed(3), digAngle: +a.digAngle.toFixed(3),
    stuck: a.stuck, digCD: a.digCD, digCount: a.digCount,
    stateTimer: a.stateTimer, timeSinceRest: a.timeSinceRest,
    feedCount: a.feedCount || 0,
    role: a.role, name: a.name,
    size: +a.size.toFixed(2), hue: +a.hue.toFixed(1),
  }));

  return {
    v: 11,
    grid: gridB64,
    phTrail, phFood, phDig,
    ants, foods: state.foods,
    chambers: state.chambers,
    brood: state.brood || [],
    foodStores: state.foodStores || [],
    frame: state.frame, totalDug: state.totalDug, simDay: state.simDay,
    hasQueen: state.hasQueen, queenUnderground: state.queenUnderground || false,
    entranceX: state.entranceX,
    narration: state.narration, insight: state.insight,
    digPriority: state.digPriority,
    directive: state.directive || null,
    tuning: state.tuning,
    colonyGoals: state.colonyGoals,
    nextId: AF.ant.getNextId(),
  };
};

AF.colony.deserialize = function(data) {
  const tuning = data.tuning || {
    restThreshold: 20,
    explorationBias: 0.3,
    forageRadius: 200,
    branchingChance: 0.15,
    chamberSizeTarget: 60,
    antMaxEnergy: 100,
    queenSpawnRate: 1800,
    sandCarryMax: 5,
    nursePriority: 5,
  };
  if (!tuning.nursePriority) tuning.nursePriority = 5;

  const state = {
    grid: _base64ToUint8(data.grid),
    phTrail: _sparseDecode(data.phTrail, AF.COLS * AF.ROWS),
    phFood: _sparseDecode(data.phFood, AF.COLS * AF.ROWS),
    phDig: _sparseDecode(data.phDig, AF.COLS * AF.ROWS),
    ants: [],
    foods: data.foods || [],
    chambers: data.chambers || [],
    brood: data.brood || [],
    foodStores: data.foodStores || [],
    frame: data.frame || 0,
    totalDug: data.totalDug || 0,
    simDay: data.simDay || 1,
    hasQueen: data.hasQueen || false,
    queenUnderground: data.queenUnderground || false,
    entranceX: data.entranceX != null ? data.entranceX : -1,
    terrainDirty: true,
    narration: data.narration || '',
    insight: data.insight || '',
    directive: data.directive || null,
    tokenUsage: null,
    digPriority: data.digPriority || 7,
    tuning: tuning,
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
      maturity: a.maturity || (a.isQueen ? 1.0 : 0.5),
      carrying: a.carrying, carryingSand: a.carryingSand || 0,
      carryingFood: a.carryingFood || 0,
      maxSandCarry: a.maxSandCarry || 5,
      heading: a.heading || 0, digAngle: a.digAngle || Math.PI * 0.5,
      stuck: a.stuck || 0, digCD: a.digCD || 0, digCount: a.digCount || 0,
      stateTimer: a.stateTimer || 0, timeSinceRest: a.timeSinceRest || 0,
      feedCount: a.feedCount || 0,
      role: a.role || 'idle', name: a.name,
      size: a.size, hue: a.hue,
    });
    state.ants.push(ant);
  }

  return state;
};

// ── Role counts (for HUD) ──

AF.colony.getRoleCounts = function(state) {
  const counts = { digger: 0, forager: 0, explorer: 0, nurse: 0, idle: 0, resting: 0 };
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
