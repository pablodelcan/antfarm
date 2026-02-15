// =====================================================================
//  ANTFARM v12 — Behavior: Goal-driven AI with colony intelligence
//
//  States: IDLE, ENTER, DIG, HAUL, FORAGE, CARRY, EXPLORE, REST
//
//  Key principles:
//  - Ants MUST carry excavated sand to surface (no disappearing dirt)
//  - Colony maintains shared goals that ants self-assign to
//  - Each ant has initiative: evaluates colony needs and volunteers
//  - Long-term: build main shaft → branch galleries → carve chambers
//  - Short-term: dig, haul, forage, explore, rest cycles
// =====================================================================

'use strict';

AF.behavior = {};

// ── Tuning Constants ──
const B_REST_MIN = 400;
const B_REST_MAX = 900;
const B_REST_DUR_MIN = 40;
const B_REST_DUR_MAX = 100;
const B_DIG_CD_BASE = 4;
const B_STUCK_TELEPORT = 6;
const B_STUCK_DROP = 20;
const B_ENTER_PATIENCE = 80;
const B_SATURATION = 5.0;
const B_BRANCH_CHANCE = 0.008;

// ── Colony Goal Priorities (shared brain) ──
// Updated every 120 frames based on colony state
const GOAL_WEIGHTS = {
  SHAFT:   { minDepth: 0,  maxDepth: 80,  priority: 10 },
  GALLERY: { minDepth: 20, maxDepth: 120, priority: 6 },
  CHAMBER: { minDepth: 30, maxDepth: 100, priority: 4 },
  FORAGE:  { priority: 3 },
  EXPLORE: { priority: 2 },
};

// ── Colony intelligence: assess and update goals ──
AF.behavior.updateColonyGoals = function(state) {
  if (!state.colonyGoals) {
    state.colonyGoals = {
      shaftDepth: 0,        // How deep main shaft goes
      targetShaftDepth: 60, // Goal depth for shaft
      galleryCount: 0,
      targetGalleries: 3,
      chamberCount: 0,
      targetChambers: 2,
      foodReserves: 0,
      needsFood: false,
      exploredArea: 0,
      phase: 'shaft',       // shaft → gallery → chamber → expand
    };
  }

  const g = state.colonyGoals;

  // Measure actual shaft depth
  const entranceX = state.entranceX;
  if (entranceX > 0) {
    let depth = 0;
    for (let y = AF.SURFACE + 1; y < AF.ROWS; y++) {
      if (!state.grid[y * AF.COLS + entranceX]) {
        depth = y - AF.SURFACE;
      } else {
        break;
      }
    }
    g.shaftDepth = depth;
  }

  // Count chambers and galleries from detected chambers
  g.chamberCount = state.chambers.length;
  g.galleryCount = Math.max(0, g.chamberCount - 1);

  // Food assessment
  g.foodReserves = state.foods.reduce((s, f) => s + f.amount, 0);
  g.needsFood = g.foodReserves < 5 && state.ants.length > 15;

  // Phase progression
  if (g.shaftDepth < g.targetShaftDepth * 0.6) {
    g.phase = 'shaft';
  } else if (g.galleryCount < g.targetGalleries) {
    g.phase = 'gallery';
  } else if (g.chamberCount < g.targetChambers) {
    g.phase = 'chamber';
  } else {
    g.phase = 'expand';
    // Raise targets for next phase
    g.targetShaftDepth = Math.min(150, g.targetShaftDepth + 20);
    g.targetGalleries = g.targetGalleries + 2;
    g.targetChambers = g.targetChambers + 1;
  }

  // Set dig priority based on phase
  switch (g.phase) {
    case 'shaft':   state.digPriority = 9; break;
    case 'gallery': state.digPriority = 7; break;
    case 'chamber': state.digPriority = 5; break;
    case 'expand':  state.digPriority = 6; break;
  }

  // Override if food critical
  if (g.needsFood) state.digPriority = Math.min(state.digPriority, 4);
};

// ── Main update: sense → think → act for one ant ──
AF.behavior.update = function(state, ant) {
  if (ant.isQueen) {
    _queenBehavior(state, ant);
    return;
  }

  // Cooldowns
  if (ant.digCD > 0) ant.digCD--;
  ant.age++;
  ant.stateTimer++;
  ant.timeSinceRest++;

  // Energy drain
  ant.energy -= 0.1;
  if (ant.energy <= 0) {
    ant.energy = 0;
    ant._dead = true;
    return;
  }

  // Micro-pause (natural hesitation — looks more lifelike)
  if (ant.pauseTimer > 0) {
    ant.pauseTimer--;
    ant.vx *= 0.8;
    ant.vy *= 0.8;
    return;
  }
  if (ant.state !== AF.ST.REST && ant.state !== AF.ST.HAUL && Math.random() < 0.002) {
    ant.pauseTimer = 3 + (Math.random() * 6) | 0;
    return;
  }

  // Sense
  const s = _sense(state, ant);

  // Think (goal-driven state transitions)
  _think(state, ant, s);

  // Act (movement + actions)
  _act(state, ant, s);

  // Physics
  _physics(state, ant);

  // Update display role
  AF.ant.updateRole(ant);
};

// ═══════════════════════════════════════════════════════════════════
//  SENSE — gather information about surroundings
// ═══════════════════════════════════════════════════════════════════

function _sense(state, ant) {
  const gx = AF.ant.gx(ant);
  const gy = AF.ant.gy(ant);
  const solid = AF.terrain.isSolid;

  return {
    gx, gy,
    atSurface: gy <= AF.SURFACE,
    underground: gy > AF.SURFACE + 1,
    below: solid(state, gx, gy + 1),
    above: solid(state, gx, gy - 1),
    left:  solid(state, gx - 1, gy),
    right: solid(state, gx + 1, gy),
    digGrad:   AF.pheromones.gradient(state, gx, gy, 'phDig', 5),
    trailGrad: AF.pheromones.gradient(state, gx, gy, 'phTrail', 5),
    foodGrad:  AF.pheromones.gradient(state, gx, gy, 'phFood', 6),
    digNearby: AF.pheromones.nearby(state, gx, gy, 'phDig', 3),
    nearestFood: _findNearestFood(state, ant),
  };
}

function _findNearestFood(state, ant) {
  let best = null, bestDist = 60;
  for (const food of state.foods) {
    if (food.amount <= 0) continue;
    const d = Math.hypot(food.x - ant.x, food.y - ant.y);
    if (d < bestDist) { bestDist = d; best = food; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════
//  THINK — goal-driven state machine with initiative
// ═══════════════════════════════════════════════════════════════════

function _think(state, ant, s) {
  const ST = AF.ST;
  const goals = state.colonyGoals;

  // ── Rest check (biological need overrides all) ──
  if (ant.state !== ST.REST && ant.timeSinceRest > B_REST_MIN + Math.random() * (B_REST_MAX - B_REST_MIN)) {
    if (ant.energy < 600 || ant.timeSinceRest > B_REST_MAX) {
      _changeState(ant, ST.REST);
      ant.restDuration = B_REST_DUR_MIN + (Math.random() * (B_REST_DUR_MAX - B_REST_DUR_MIN)) | 0;
      AF.ant.setThought(ant, 'Need to rest');
      return;
    }
  }

  // ── Stuck escape ──
  if (ant.stuck >= B_STUCK_TELEPORT) {
    _unstick(state, ant);
    return;
  }

  switch (ant.state) {

    // ── IDLE: evaluate colony needs and self-assign ──
    case ST.IDLE:
      // Initiative system: ant evaluates what colony needs most
      if (ant.stateTimer > 15) {
        const decision = _evaluateInitiative(state, ant, s, goals);
        if (decision) return;
      }

      // Fallback: after patience, enter tunnel
      if (ant.stateTimer > B_ENTER_PATIENCE * (0.5 + Math.random())) {
        _changeState(ant, ST.ENTER);
        AF.ant.setThought(ant, 'Time to work');
        return;
      }
      break;

    // ── ENTER: walking to entrance and descending ──
    case ST.ENTER:
      if (s.underground) {
        // Decide based on colony phase and personal goal
        const task = _assignUndergroundTask(state, ant, s, goals);
        if (task === 'dig') {
          _changeState(ant, ST.DIG);
          ant.digCount = 0;
          // Set dig angle based on colony phase
          if (goals && goals.phase === 'shaft') {
            ant.digAngle = Math.PI * 0.5; // straight down
            AF.ant.setThought(ant, 'Deepening main shaft');
          } else if (goals && goals.phase === 'gallery') {
            ant.digAngle = Math.PI * 0.5 + (Math.random() - 0.5) * 1.2;
            AF.ant.setThought(ant, 'Branching new gallery');
          } else if (goals && goals.phase === 'chamber') {
            ant.digAngle = Math.PI * 0.5 + (Math.random() - 0.5) * 0.8;
            AF.ant.setThought(ant, 'Carving chamber space');
          } else {
            ant.digAngle = Math.PI * 0.5 + (Math.random() - 0.5) * 0.6;
            AF.ant.setThought(ant, 'Expanding tunnels');
          }
        } else {
          _changeState(ant, ST.EXPLORE);
          AF.ant.setThought(ant, 'Scouting new paths');
        }
        return;
      }
      break;

    // ── DIG: excavating with purpose ──
    case ST.DIG:
      // Sand full? MUST haul it to surface (no vanishing dirt!)
      if (ant.carryingSand >= ant.maxSandCarry) {
        _changeState(ant, ST.HAUL);
        AF.ant.setThought(ant, 'Hauling sand to surface');
        return;
      }
      // At surface? Done digging this round
      if (s.atSurface && ant.stateTimer > 10) {
        _changeState(ant, ST.IDLE);
        return;
      }
      // Detect overcrowding: if too many diggers nearby, branch off
      if (s.digNearby > B_SATURATION && Math.random() < 0.05) {
        const branchDir = Math.random() < 0.5 ? -1 : 1;
        ant.digAngle += branchDir * (0.8 + Math.random() * 0.8);
        AF.ant.setThought(ant, 'Area crowded, branching');
      }
      // Chamber creation: when deep enough and phase is 'chamber', dig wider
      if (goals && goals.phase === 'chamber' && s.gy > AF.SURFACE + 30 && Math.random() < 0.02) {
        ant.digAngle += (Math.random() - 0.5) * 1.5;
        AF.ant.setThought(ant, 'Widening for chamber');
      }
      break;

    // ── HAUL: carrying sand to surface — CRITICAL path ──
    case ST.HAUL:
      if (s.atSurface) {
        // Deposit sand as surface mounds (visible terrain change!)
        for (let si = 0; si < ant.carryingSand; si++) {
          AF.terrain.depositSand(state, s.gx);
        }
        ant.carryingSand = 0;
        _changeState(ant, ST.IDLE);
        ant.energy = Math.min(ant.energy + 30, 1100); // small energy from completing task
        AF.ant.setThought(ant, 'Sand deposited on surface');
        return;
      }
      // Stuck too long with sand? Emergency drop
      if (ant.stuck >= B_STUCK_DROP) {
        ant.carryingSand = 0;
        _changeState(ant, ST.EXPLORE);
        ant.stuck = 0;
        AF.ant.setThought(ant, 'Lost sand, finding way');
        return;
      }
      // Taking too long? Drop sand in tunnel (creates fill)
      if (ant.stateTimer > 400) {
        // Deposit sand in current location (fills tunnel slightly)
        for (let si = 0; si < ant.carryingSand; si++) {
          const dx = ((Math.random() * 3) | 0) - 1;
          const dy = ((Math.random() * 3) | 0) - 1;
          const tx = s.gx + dx, ty = s.gy + dy;
          if (tx >= 0 && tx < AF.COLS && ty >= 0 && ty < AF.ROWS && !state.grid[ty * AF.COLS + tx]) {
            state.grid[ty * AF.COLS + tx] = 1;
            state.terrainDirty = true;
          }
        }
        ant.carryingSand = 0;
        _changeState(ant, ST.DIG);
        ant.digAngle = Math.PI * 0.5;
        ant.digCount = 0;
        ant.stuck = 0;
        AF.ant.setThought(ant, 'Dropped sand underground');
        return;
      }
      break;

    // ── FORAGE: seeking food with purpose ──
    case ST.FORAGE:
      if (s.nearestFood && Math.hypot(s.nearestFood.x - ant.x, s.nearestFood.y - ant.y) < AF.CELL * 3) {
        s.nearestFood.amount -= 1;
        ant.carrying = true;
        ant.energy = Math.min(ant.energy + 100, 1100);
        _changeState(ant, ST.CARRY);
        AF.ant.setThought(ant, 'Found food!');
        return;
      }
      // No food after patient search? Report back
      if (ant.stateTimer > 180 && s.foodGrad.strength < 0.02 && !s.nearestFood) {
        _changeState(ant, ST.EXPLORE);
        AF.ant.setThought(ant, 'No food here, exploring');
        return;
      }
      break;

    // ── CARRY: bringing food to colony ──
    case ST.CARRY:
      if (s.atSurface) {
        ant.carrying = false;
        ant.energy = Math.min(ant.energy + 200, 1100);
        _changeState(ant, ST.IDLE);
        AF.ant.setThought(ant, 'Food delivered to colony');
        return;
      }
      break;

    // ── EXPLORE: scouting with purpose ──
    case ST.EXPLORE:
      // Found promising dig site? Join if colony needs diggers
      if (s.digGrad.strength > 0.15 && Math.random() < 0.02) {
        if (state.digPriority > 4) {
          _changeState(ant, ST.DIG);
          ant.digAngle = s.digGrad.angle || Math.PI * 0.5;
          ant.digCount = 0;
          AF.ant.setThought(ant, 'Joining dig effort');
          return;
        }
      }
      // Smelled food? Colony might need it
      if (s.foodGrad.strength > 0.1 && Math.random() < 0.05) {
        _changeState(ant, ST.FORAGE);
        AF.ant.setThought(ant, 'Found food trail');
        return;
      }
      // Done exploring? Head back with findings
      if (ant.stateTimer > 300 + Math.random() * 200) {
        _changeState(ant, ST.HAUL);
        ant.carryingSand = 0;
        AF.ant.setThought(ant, 'Reporting back');
        return;
      }
      break;

    // ── REST: recovery ──
    case ST.REST:
      ant.energy = Math.min(ant.energy + 0.6, 1100);
      ant.vx *= 0.9;
      ant.vy *= 0.9;
      if (ant.stateTimer > ant.restDuration) {
        ant.timeSinceRest = 0;
        _changeState(ant, ant.prevState !== ST.REST ? ant.prevState : ST.IDLE);
        AF.ant.setThought(ant, 'Refreshed and ready');
      }
      return;
  }
}

// ── Initiative system: ant evaluates colony needs ──
function _evaluateInitiative(state, ant, s, goals) {
  const ST = AF.ST;

  // High-priority: if food is nearby, go get it
  if (s.nearestFood && Math.random() < 0.4) {
    _changeState(ant, ST.FORAGE);
    AF.ant.setThought(ant, 'Food spotted nearby');
    return true;
  }

  // Food pheromone detection
  if (s.foodGrad.strength > 0.1 && Math.random() < 0.15) {
    _changeState(ant, ST.FORAGE);
    AF.ant.setThought(ant, 'Following food scent');
    return true;
  }

  // Colony needs assessment
  if (goals) {
    const roles = AF.colony.getRoleCounts(state);
    const totalWorkers = state.ants.length - (state.hasQueen ? 1 : 0);

    // Phase-driven decisions
    switch (goals.phase) {
      case 'shaft':
        // Colony needs diggers badly — most ants should dig
        if (roles.digger < totalWorkers * 0.6 && Math.random() < 0.4) {
          _changeState(ant, ST.ENTER);
          AF.ant.setThought(ant, 'Colony needs shaft work');
          return true;
        }
        break;

      case 'gallery':
        // Need mix of diggers and explorers
        if (roles.digger < totalWorkers * 0.4 && Math.random() < 0.3) {
          _changeState(ant, ST.ENTER);
          AF.ant.setThought(ant, 'Helping dig galleries');
          return true;
        }
        if (roles.explorer < totalWorkers * 0.15 && Math.random() < 0.2) {
          _changeState(ant, ST.ENTER);
          ant._goalExplore = true;
          AF.ant.setThought(ant, 'Scouting for galleries');
          return true;
        }
        break;

      case 'chamber':
        // Need diggers for chamber, some explorers
        if (roles.digger < totalWorkers * 0.35 && Math.random() < 0.25) {
          _changeState(ant, ST.ENTER);
          AF.ant.setThought(ant, 'Chamber work needed');
          return true;
        }
        break;

      case 'expand':
        // Balanced: dig, explore, forage
        if (roles.digger < totalWorkers * 0.3 && Math.random() < 0.2) {
          _changeState(ant, ST.ENTER);
          AF.ant.setThought(ant, 'Expanding colony');
          return true;
        }
        if (roles.explorer < totalWorkers * 0.2 && Math.random() < 0.15) {
          _changeState(ant, ST.ENTER);
          ant._goalExplore = true;
          AF.ant.setThought(ant, 'Exploring new territory');
          return true;
        }
        break;
    }

    // If colony needs food, volunteer to forage
    if (goals.needsFood && roles.forager < totalWorkers * 0.2 && Math.random() < 0.2) {
      _changeState(ant, ST.FORAGE);
      AF.ant.setThought(ant, 'Colony needs food');
      return true;
    }
  }

  // High dig priority from AI directive
  if (state.digPriority > 6 && ant.stateTimer > 30 && Math.random() < 0.03) {
    _changeState(ant, ST.ENTER);
    AF.ant.setThought(ant, 'Answering dig call');
    return true;
  }

  return false;
}

// ── Assign task when ant arrives underground ──
function _assignUndergroundTask(state, ant, s, goals) {
  // If ant was sent to explore
  if (ant._goalExplore) {
    ant._goalExplore = false;
    return 'explore';
  }

  // Check dig pheromone — join existing dig if strong signal
  if (s.digGrad.strength > 0.05) return 'dig';

  // Based on colony phase
  if (goals) {
    switch (goals.phase) {
      case 'shaft': return 'dig';
      case 'gallery': return Math.random() < 0.7 ? 'dig' : 'explore';
      case 'chamber': return Math.random() < 0.6 ? 'dig' : 'explore';
      case 'expand': return Math.random() < 0.5 ? 'dig' : 'explore';
    }
  }

  return Math.random() < 0.7 ? 'dig' : 'explore';
}

// ═══════════════════════════════════════════════════════════════════
//  ACT — execute movement and actions for current state
// ═══════════════════════════════════════════════════════════════════

function _act(state, ant, s) {
  const ST = AF.ST;
  const spd = AF.ant.speed(ant);

  switch (ant.state) {

    case ST.IDLE:
      _moveWander(ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.04, 'phTrail');
      break;

    case ST.ENTER:
      _moveEnter(state, ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.1, 'phTrail');
      break;

    case ST.DIG:
      _moveDig(state, ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.25, 'phDig');
      AF.pheromones.set(state, s.gx, s.gy, 0.15, 'phTrail');
      break;

    case ST.HAUL:
      _moveUp(state, ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.12, 'phTrail');
      break;

    case ST.FORAGE:
      _moveForage(state, ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.06, 'phTrail');
      break;

    case ST.CARRY:
      _moveUp(state, ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.3, 'phFood');
      AF.pheromones.set(state, s.gx, s.gy, 0.15, 'phTrail');
      break;

    case ST.EXPLORE:
      _moveExplore(state, ant, s, spd);
      AF.pheromones.set(state, s.gx, s.gy, 0.08, 'phTrail');
      break;
  }

  // Animation
  const moving = Math.hypot(ant.vx, ant.vy) > 0.08;
  if (moving) {
    ant.legT += 0.22;
    ant.antT += 0.07;
    ant.bodyBob = Math.sin(ant.legT * 0.4) * 0.3;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  MOVEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function _moveWander(ant, s, spd) {
  ant.meanderPhase += ant.meanderFreq;
  ant.heading += Math.sin(ant.meanderPhase) * 0.12;

  if (!s.atSurface) ant.heading = -Math.PI * 0.5;

  ant.vx += Math.cos(ant.heading) * spd * 0.3;
  ant.vy += Math.sin(ant.heading) * spd * 0.15;

  // Surface gravity
  if (ant.y < AF.SURFACE_PX) ant.vy += 0.1;
  if (ant.y > AF.SURFACE_PX + AF.CELL * 2) ant.vy -= 0.15;

  // Edge bounce
  if (ant.x < AF.FRAME + AF.CELL * 4) ant.vx += 0.3;
  if (ant.x > AF.W - AF.FRAME - AF.CELL * 4) ant.vx -= 0.3;

  ant.vx *= 0.88;
  ant.vy *= 0.88;
}

function _moveEnter(state, ant, s, spd) {
  const entranceX = state.entranceX;
  if (entranceX < 0) {
    state.entranceX = s.gx;
    return;
  }

  const targetPx = entranceX * AF.CELL + AF.CELL / 2;

  if (s.atSurface) {
    const dx = targetPx - ant.x;
    if (Math.abs(dx) > AF.CELL) {
      ant.vx += Math.sign(dx) * spd * 0.4;
      ant.heading = dx > 0 ? 0 : Math.PI;
    } else {
      ant.vx *= 0.5;
      ant.vy += spd * 0.6;
      ant.heading = Math.PI * 0.5;
      if (ant.digCD <= 0) {
        // Dig entrance shaft - ant picks up sand
        const dug1 = AF.terrain.dig(state, s.gx, s.gy + 1);
        const dug2 = AF.terrain.dig(state, s.gx, s.gy + 2);
        if (dug1) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
        if (dug2) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
        ant.digCD = B_DIG_CD_BASE;
      }
    }
  } else {
    ant.vy += spd * 0.6;
    ant.vx *= 0.3;
    if (ant.digCD <= 0) {
      const dug1 = AF.terrain.dig(state, s.gx, s.gy + 1);
      const dug2 = AF.terrain.dig(state, s.gx, s.gy + 2);
      if (dug1) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
      if (dug2) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
      ant.digCD = B_DIG_CD_BASE;
    }
  }

  ant.vx *= 0.88;
  ant.vy *= 0.9;
}

function _moveDig(state, ant, s, spd) {
  const depthBelow = s.gy - AF.SURFACE;
  const nearSurface = depthBelow < 20;
  const goals = state.colonyGoals;

  // Natural heading perturbation
  if (Math.random() < (nearSurface ? 0.002 : B_BRANCH_CHANCE)) {
    ant.digAngle += (Math.random() - 0.5) * (nearSurface ? 0.2 : 0.6);
  }

  // Near surface: force straight down for clean shaft
  if (nearSurface) {
    ant.digAngle += (Math.PI * 0.5 - ant.digAngle) * 0.25;
    if (state.entranceX > 0) {
      const targetX = state.entranceX * AF.CELL + AF.CELL / 2;
      const drift = Math.abs(ant.x - targetX);
      if (drift > AF.CELL * 2) {
        ant.x = targetX;
        ant.vx = 0;
      } else {
        ant.vx += (targetX - ant.x) * 0.1;
      }
    }
  }

  // Chamber digging: when in chamber phase and deep enough, dig wider pattern
  if (goals && goals.phase === 'chamber' && depthBelow > 30) {
    if (ant.digCount > 5 && ant.digCount % 8 === 0) {
      // Dig radially to create chamber space
      for (let a = 0; a < 6.28; a += 1.0) {
        const cx = s.gx + Math.round(Math.cos(a) * 2);
        const cy = s.gy + Math.round(Math.sin(a) * 2);
        if (AF.terrain.isSolid(state, cx, cy)) {
          const dug = AF.terrain.dig(state, cx, cy);
          if (dug) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
        }
      }
      AF.ant.setThought(ant, 'Carving chamber walls');
    }
  }

  // Follow dig pheromone gradient
  if (s.digGrad.angle !== null && Math.random() < 0.3) {
    ant.digAngle += (s.digGrad.angle - ant.digAngle) * 0.1;
  }

  // Clamp dig angle (mostly downward)
  ant.digAngle = AF.clamp(ant.digAngle, 0.2, 2.94);
  ant.heading += (ant.digAngle - ant.heading) * 0.15;

  ant.vx += Math.cos(ant.heading) * spd * 0.35;
  ant.vy += Math.sin(ant.heading) * spd * 0.35;

  // Dig ahead — ALWAYS pick up sand (no vanishing!)
  if (ant.digCD <= 0 && ant.carryingSand < ant.maxSandCarry) {
    const dgx = s.gx + Math.round(Math.cos(ant.heading) * 1.5);
    const dgy = s.gy + Math.round(Math.sin(ant.heading) * 1.5);
    if (AF.terrain.isSolid(state, dgx, dgy)) {
      const dug = AF.terrain.dig(state, dgx, dgy);
      if (dug) {
        ant.carryingSand++;
        ant.digCount++;
        ant.digCD = B_DIG_CD_BASE + (Math.random() * 4) | 0;
        ant.stuck = 0;
      }
    }
    // Dig current cell if stuck
    if (AF.terrain.isSolid(state, s.gx, s.gy)) {
      const dug = AF.terrain.dig(state, s.gx, s.gy);
      if (dug) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
    }
    // Wider digging for galleries (every 3rd dig)
    if (!nearSurface && ant.digCount % 3 === 0 && ant.carryingSand < ant.maxSandCarry) {
      const d2x = s.gx + Math.round(Math.cos(ant.heading) * 2.5);
      const d2y = s.gy + Math.round(Math.sin(ant.heading) * 2.5);
      if (AF.terrain.isSolid(state, d2x, d2y)) {
        const dug = AF.terrain.dig(state, d2x, d2y);
        if (dug) ant.carryingSand = Math.min(ant.carryingSand + 1, ant.maxSandCarry);
      }
    }
  }

  // Don't dig above surface
  if (s.atSurface) {
    ant.digAngle = Math.max(ant.digAngle, Math.PI * 0.4);
    ant.vy = Math.max(ant.vy, 0);
  }

  ant.vx *= 0.85;
  ant.vy *= 0.88;
}

function _moveUp(state, ant, s, spd) {
  let bestAngle = -Math.PI * 0.5;
  let bestScore = -99;
  let foundOpen = false;

  for (let a = -Math.PI; a < Math.PI; a += 0.4) {
    if (a > 0.3 && a < 2.84) continue;
    for (let dist = 1; dist <= 3; dist++) {
      const cx = s.gx + Math.round(Math.cos(a) * dist);
      const cy = s.gy + Math.round(Math.sin(a) * dist);
      if (!AF.terrain.isSolid(state, cx, cy)) {
        const score = -cy * 3 + AF.pheromones.get(state, cx, cy, 'phTrail') * 2;
        if (score > bestScore) { bestScore = score; bestAngle = a; foundOpen = true; }
        break;
      }
    }
  }

  if (!foundOpen && ant.digCD <= 0) {
    if (AF.terrain.isSolid(state, s.gx, s.gy - 1)) {
      AF.terrain.dig(state, s.gx, s.gy - 1);
      ant.digCD = B_DIG_CD_BASE;
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    if (AF.terrain.isSolid(state, s.gx + side, s.gy - 1)) {
      AF.terrain.dig(state, s.gx + side, s.gy - 1);
    }
  }

  ant.heading += (bestAngle - ant.heading) * 0.3;
  ant.vx += Math.cos(ant.heading) * spd * 0.5;
  ant.vy += Math.sin(ant.heading) * spd * 0.5;
  ant.vy -= spd * 0.25;

  if (s.trailGrad.angle !== null) {
    if (Math.sin(s.trailGrad.angle) < -0.1) {
      ant.heading += (s.trailGrad.angle - ant.heading) * 0.1;
    }
  }

  ant.vx *= 0.88;
  ant.vy *= 0.9;
}

function _moveForage(state, ant, s, spd) {
  if (s.nearestFood) {
    const dx = s.nearestFood.x - ant.x;
    const dy = s.nearestFood.y - ant.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      ant.heading = Math.atan2(dy, dx);
      ant.vx += (dx / dist) * spd * 0.4;
      ant.vy += (dy / dist) * spd * 0.4;
    }
  } else if (s.foodGrad.angle !== null) {
    ant.heading += (s.foodGrad.angle - ant.heading) * 0.15;
    ant.vx += Math.cos(ant.heading) * spd * 0.3;
    ant.vy += Math.sin(ant.heading) * spd * 0.3;
  } else {
    _moveExplore(state, ant, s, spd);
  }

  ant.vx *= 0.88;
  ant.vy *= 0.88;
}

function _moveExplore(state, ant, s, spd) {
  ant.meanderPhase += ant.meanderFreq;
  ant.heading += Math.sin(ant.meanderPhase) * 0.15;

  // Avoid trail pheromone (explore NEW areas)
  if (s.trailGrad.angle !== null && Math.random() < 0.15) {
    ant.heading += ((s.trailGrad.angle + Math.PI) - ant.heading) * 0.08;
  }

  // Wall avoidance
  if (s.left) ant.heading -= 0.3;
  if (s.right) ant.heading += 0.3;
  if (s.below && !s.above) ant.heading -= 0.2;

  ant.vx += Math.cos(ant.heading) * spd * 0.35;
  ant.vy += Math.sin(ant.heading) * spd * 0.35;

  ant.vx *= 0.87;
  ant.vy *= 0.87;
}

// ═══════════════════════════════════════════════════════════════════
//  PHYSICS — gravity, collision, bounds
// ═══════════════════════════════════════════════════════════════════

function _physics(state, ant) {
  const spd = AF.ant.speed(ant);
  const maxV = spd * 3;

  ant.vx = AF.clamp(ant.vx, -maxV, maxV);
  ant.vy = AF.clamp(ant.vy, -maxV, maxV);

  const gx = AF.ant.gx(ant);
  const gy = AF.ant.gy(ant);
  if (!AF.terrain.isSolid(state, gx, gy + 1) && gy < AF.ROWS - 1) {
    ant.vy += 0.2;
  }
  if ((AF.terrain.isSolid(state, gx - 1, gy) || AF.terrain.isSolid(state, gx + 1, gy))
      && !AF.terrain.isSolid(state, gx, gy + 1)) {
    ant.vy *= 0.35;
  }

  let nx = ant.x + ant.vx;
  let ny = ant.y + ant.vy;
  const ngx = (nx / AF.CELL) | 0;
  const ngy = (ny / AF.CELL) | 0;
  const digging = ant.state === AF.ST.DIG || ant.state === AF.ST.ENTER;

  if (AF.terrain.isSolid(state, ngx, ngy) && !digging) {
    if (!AF.terrain.isSolid(state, gx, ngy)) {
      nx = ant.x; ant.vx *= 0.15;
      ant.stuck += 0.3;
    } else if (!AF.terrain.isSolid(state, ngx, gy)) {
      ny = ant.y; ant.vy *= 0.15;
      ant.stuck += 0.3;
    } else {
      nx = ant.x; ny = ant.y;
      ant.vx *= 0.05; ant.vy *= 0.05;
      ant.stuck += 1.5;
    }
  } else {
    const vel = Math.hypot(ant.vx, ant.vy);
    if (vel > 0.05) {
      ant.stuck = Math.max(0, ant.stuck - 0.5);
    }
    if (vel < 0.02 && ant.state !== AF.ST.REST && ant.state !== AF.ST.IDLE) {
      ant.stuck += 0.15;
    }
  }

  ant.x = AF.clamp(nx, AF.FRAME + AF.CELL, AF.W - AF.FRAME - AF.CELL);
  ant.y = AF.clamp(ny, AF.SURFACE_PX - AF.CELL * 5, AF.H - AF.FRAME * 2.5 - AF.CELL);
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

function _changeState(ant, newState) {
  ant.prevState = ant.state;
  ant.state = newState;
  ant.stateTimer = 0;
  ant.stuck = 0;
}

function _unstick(state, ant) {
  let gy = AF.ant.gy(ant);
  const gx = AF.ant.gx(ant);

  let found = false;
  for (let dy = -1; dy >= -30; dy--) {
    if (!AF.terrain.isSolid(state, gx, gy + dy)) {
      ant.x = gx * AF.CELL + AF.CELL / 2;
      ant.y = (gy + dy) * AF.CELL + AF.CELL / 2;
      found = true;
      break;
    }
  }

  if (!found) {
    for (let r = 1; r <= 8; r++) {
      for (const dx of [-r, r]) {
        for (let dy = -3; dy <= 0; dy++) {
          if (!AF.terrain.isSolid(state, gx + dx, gy + dy)) {
            ant.x = (gx + dx) * AF.CELL + AF.CELL / 2;
            ant.y = (gy + dy) * AF.CELL + AF.CELL / 2;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
  }

  if (!found) {
    ant.x = gx * AF.CELL + AF.CELL / 2;
    ant.y = AF.SURFACE_PX - AF.CELL;
  }

  ant.vx = 0; ant.vy = 0; ant.stuck = 0;
  AF.ant.setThought(ant, 'Found my way out');
}

function _queenBehavior(state, ant) {
  const s = _sense(state, ant);
  ant.age++;

  if (state.entranceX > 0) {
    const targetX = state.entranceX * AF.CELL + AF.CELL / 2;
    ant.vx += (targetX - ant.x) * 0.01;
  }

  if (ant.y > AF.SURFACE_PX + AF.CELL) ant.vy -= 0.2;
  if (ant.y < AF.SURFACE_PX - AF.CELL * 3) ant.vy += 0.15;

  ant.meanderPhase += 0.02;
  ant.vx += Math.sin(ant.meanderPhase) * 0.05;

  ant.vx *= 0.92;
  ant.vy *= 0.9;

  if (!s.below) ant.vy += 0.15;

  ant.x += ant.vx;
  ant.y += ant.vy;
  ant.x = AF.clamp(ant.x, AF.FRAME + AF.CELL * 3, AF.W - AF.FRAME - AF.CELL * 3);
  ant.y = AF.clamp(ant.y, AF.SURFACE_PX - AF.CELL * 4, AF.SURFACE_PX + AF.CELL * 3);

  ant.legT += 0.08;
  ant.antT += 0.04;
  ant.bodyBob = Math.sin(ant.legT * 0.3) * 0.2;
  ant.state = AF.ST.IDLE;
  ant.role = 'queen';
}
