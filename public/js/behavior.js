// =====================================================================
//  ANTFARM v10 — Behavior: 8-state sense/think/act machine
//
//  States: IDLE, ENTER, DIG, HAUL, FORAGE, CARRY, EXPLORE, REST
//  Tunnels form via pheromone following, not rigid planning.
// =====================================================================

'use strict';

AF.behavior = {};

// ── Constants ──
const B_REST_MIN = 180;       // Min frames between rests
const B_REST_MAX = 500;       // Max frames between rests
const B_REST_DUR_MIN = 60;    // Min rest duration
const B_REST_DUR_MAX = 180;   // Max rest duration
const B_DIG_CD_BASE = 8;      // Base dig cooldown
const B_STUCK_TELEPORT = 6;   // Frames stuck before teleport
const B_STUCK_DROP = 20;      // Frames stuck before dropping cargo
const B_ENTER_PATIENCE = 120; // Frames idle before entering tunnel
const B_SATURATION = 5.0;     // Dig pheromone saturation (triggers branching)
const B_BRANCH_CHANCE = 0.008; // Per-frame chance to shift dig angle

// ── Main update: sense, think, act for one ant ──

AF.behavior.update = function(state, ant) {
  if (ant.isQueen) {
    _queenBehavior(state, ant);
    return;
  }

  // Decrement cooldowns
  if (ant.digCD > 0) ant.digCD--;
  ant.age++;
  ant.stateTimer++;
  ant.timeSinceRest++;

  // Energy drain
  ant.energy -= 0.1;
  if (ant.energy <= 0) {
    ant.energy = 0;
    // Dead ant — mark for removal
    ant._dead = true;
    return;
  }

  // Micro-pause (natural hesitation)
  if (ant.pauseTimer > 0) {
    ant.pauseTimer--;
    ant.vx *= 0.8;
    ant.vy *= 0.8;
    return;
  }
  if (ant.state !== AF.ST.REST && Math.random() < 0.003) {
    ant.pauseTimer = 5 + (Math.random() * 10) | 0;
    return;
  }

  // Sense
  const s = _sense(state, ant);

  // Think (state transitions)
  _think(state, ant, s);

  // Act (movement + actions)
  _act(state, ant, s);

  // Physics: gravity, collision, stuck
  _physics(state, ant);

  // Update role for display
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
    atSurface: gy <= AF.SURFACE + 2,
    underground: gy > AF.SURFACE + 2,
    below: solid(state, gx, gy + 1),
    above: solid(state, gx, gy - 1),
    left:  solid(state, gx - 1, gy),
    right: solid(state, gx + 1, gy),
    // Pheromone gradients
    digGrad:   AF.pheromones.gradient(state, gx, gy, 'phDig', 5),
    trailGrad: AF.pheromones.gradient(state, gx, gy, 'phTrail', 5),
    foodGrad:  AF.pheromones.gradient(state, gx, gy, 'phFood', 6),
    // Local dig pheromone density (for saturation/crowding)
    digNearby: AF.pheromones.nearby(state, gx, gy, 'phDig', 3),
    // Nearest food
    nearestFood: _findNearestFood(state, ant),
  };
}

function _findNearestFood(state, ant) {
  let best = null, bestDist = 60; // Max sense range
  for (const food of state.foods) {
    if (food.amount <= 0) continue;
    const d = Math.hypot(food.x - ant.x, food.y - ant.y);
    if (d < bestDist) { bestDist = d; best = food; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════
//  THINK — decide state transitions
// ═══════════════════════════════════════════════════════════════════

function _think(state, ant, s) {
  const ST = AF.ST;

  // ── Rest check (universal) ──
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

    // ── IDLE: surface wandering ──
    case ST.IDLE:
      // See food nearby? Go forage
      if (s.nearestFood && Math.random() < 0.3) {
        _changeState(ant, ST.FORAGE);
        AF.ant.setThought(ant, 'I smell food');
        return;
      }
      // Sense food pheromone? Go forage
      if (s.foodGrad.strength > 0.1 && Math.random() < 0.1) {
        _changeState(ant, ST.FORAGE);
        AF.ant.setThought(ant, 'Following food trail');
        return;
      }
      // After waiting a bit, decide to enter tunnel
      if (ant.stateTimer > B_ENTER_PATIENCE * (0.5 + Math.random())) {
        _changeState(ant, ST.ENTER);
        AF.ant.setThought(ant, 'Time to dig');
        return;
      }
      // Apply directive nudge — if colony wants diggers, enter sooner
      if (state.digPriority > 5 && ant.stateTimer > 40 && Math.random() < 0.02) {
        _changeState(ant, ST.ENTER);
        AF.ant.setThought(ant, 'Colony needs diggers');
        return;
      }
      break;

    // ── ENTER: walking to entrance and descending ──
    case ST.ENTER:
      // Once underground, decide: dig or explore
      if (s.underground) {
        if (s.digGrad.strength > 0.05 || Math.random() < 0.7) {
          _changeState(ant, ST.DIG);
          ant.digAngle = Math.PI * 0.5; // start digging down
          ant.digCount = 0;
          AF.ant.setThought(ant, 'Starting to dig');
        } else {
          _changeState(ant, ST.EXPLORE);
          AF.ant.setThought(ant, 'Exploring tunnels');
        }
        return;
      }
      break;

    // ── DIG: actively excavating ──
    case ST.DIG:
      // Sand full? Switch to hauling
      if (ant.carryingSand >= ant.maxSandCarry) {
        _changeState(ant, ST.HAUL);
        AF.ant.setThought(ant, 'Sand is full, hauling up');
        return;
      }
      // At surface somehow? Go idle
      if (s.atSurface && ant.stateTimer > 10) {
        _changeState(ant, ST.IDLE);
        return;
      }
      // Dig pheromone saturated? Branch sideways
      if (s.digNearby > B_SATURATION && Math.random() < 0.05) {
        ant.digAngle += (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.8);
        AF.ant.setThought(ant, 'Too crowded, branching');
      }
      break;

    // ── HAUL: carrying sand to surface ──
    case ST.HAUL:
      // Reached surface? Deposit sand
      if (s.atSurface) {
        AF.terrain.depositSand(state, s.gx);
        ant.carryingSand = 0;
        _changeState(ant, ST.IDLE);
        AF.ant.setThought(ant, 'Deposited sand');
        return;
      }
      // Stuck too long with sand? Drop it
      if (ant.stuck >= B_STUCK_DROP) {
        ant.carryingSand = 0;
        _changeState(ant, ST.EXPLORE);
        ant.stuck = 0;
        AF.ant.setThought(ant, 'Dropped sand, exploring');
        return;
      }
      break;

    // ── FORAGE: seeking food ──
    case ST.FORAGE:
      // Adjacent to food? Pick it up
      if (s.nearestFood && Math.hypot(s.nearestFood.x - ant.x, s.nearestFood.y - ant.y) < AF.CELL * 3) {
        s.nearestFood.amount -= 1;
        ant.carrying = true;
        ant.energy = Math.min(ant.energy + 100, 1100);
        _changeState(ant, ST.CARRY);
        AF.ant.setThought(ant, 'Found food!');
        return;
      }
      // No gradient for too long? Switch to explore
      if (ant.stateTimer > 180 && s.foodGrad.strength < 0.02 && !s.nearestFood) {
        _changeState(ant, ST.EXPLORE);
        AF.ant.setThought(ant, 'No food found');
        return;
      }
      break;

    // ── CARRY: bringing food back ──
    case ST.CARRY:
      // At surface? Drop food
      if (s.atSurface) {
        ant.carrying = false;
        ant.energy = Math.min(ant.energy + 200, 1100);
        _changeState(ant, ST.IDLE);
        AF.ant.setThought(ant, 'Delivered food');
        return;
      }
      break;

    // ── EXPLORE: scouting underground ──
    case ST.EXPLORE:
      // Found dig pheromone? Join digging
      if (s.digGrad.strength > 0.15 && Math.random() < 0.02) {
        _changeState(ant, ST.DIG);
        ant.digAngle = s.digGrad.angle || Math.PI * 0.5;
        ant.digCount = 0;
        AF.ant.setThought(ant, 'Joining dig site');
        return;
      }
      // Found food pheromone? Forage
      if (s.foodGrad.strength > 0.1 && Math.random() < 0.05) {
        _changeState(ant, ST.FORAGE);
        AF.ant.setThought(ant, 'Smell food trail');
        return;
      }
      // Been exploring a while? Head up
      if (ant.stateTimer > 300 + Math.random() * 200) {
        _changeState(ant, ST.HAUL); // reuse HAUL movement (go up) with no sand
        ant.carryingSand = 0;
        AF.ant.setThought(ant, 'Heading back up');
        return;
      }
      break;

    // ── REST: recovering energy ──
    case ST.REST:
      ant.energy = Math.min(ant.energy + 0.6, 1100);
      ant.vx *= 0.9;
      ant.vy *= 0.9;
      if (ant.stateTimer > ant.restDuration) {
        ant.timeSinceRest = 0;
        _changeState(ant, ant.prevState !== ST.REST ? ant.prevState : ST.IDLE);
        AF.ant.setThought(ant, 'Feeling rested');
      }
      return; // Skip act during rest
  }
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
      // Deposit light trail pheromone
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
  // Correlated random walk on surface
  ant.meanderPhase += ant.meanderFreq;
  ant.heading += Math.sin(ant.meanderPhase) * 0.12;

  // Stay on surface
  if (!s.atSurface) ant.heading = -Math.PI * 0.5; // go up

  ant.vx += Math.cos(ant.heading) * spd * 0.3;
  ant.vy += Math.sin(ant.heading) * spd * 0.15;

  // Gentle surface gravity
  if (ant.y < AF.SURFACE_PX) ant.vy += 0.1;
  if (ant.y > AF.SURFACE_PX + AF.CELL * 2) ant.vy -= 0.15;

  // Bounce off edges
  if (ant.x < AF.FRAME + AF.CELL * 4) ant.vx += 0.3;
  if (ant.x > AF.W - AF.FRAME - AF.CELL * 4) ant.vx -= 0.3;

  // Damping
  ant.vx *= 0.88;
  ant.vy *= 0.88;
}

function _moveEnter(state, ant, s, spd) {
  const entranceX = state.entranceX;
  if (entranceX < 0) {
    // No entrance yet — first digger creates it
    state.entranceX = s.gx;
    return;
  }

  const targetPx = entranceX * AF.CELL + AF.CELL / 2;

  if (s.atSurface) {
    // Walk horizontally toward entrance
    const dx = targetPx - ant.x;
    if (Math.abs(dx) > AF.CELL) {
      ant.vx += Math.sign(dx) * spd * 0.4;
      ant.heading = dx > 0 ? 0 : Math.PI;
    } else {
      // Over entrance — descend
      ant.vx *= 0.5;
      ant.vy += spd * 0.5;
      ant.heading = Math.PI * 0.5;
      // Dig the entrance if solid below
      if (s.below) {
        if (ant.digCD <= 0) {
          AF.terrain.dig(state, s.gx, s.gy + 1);
          ant.digCD = B_DIG_CD_BASE;
        }
      }
    }
  } else {
    // Underground — keep going down
    ant.vy += spd * 0.4;
    ant.vx *= 0.3; // minimize lateral drift
  }

  // Damping
  ant.vx *= 0.85;
  ant.vy *= 0.9;
}

function _moveDig(state, ant, s, spd) {
  const depthBelow = s.gy - AF.SURFACE;
  const nearSurface = depthBelow < 20;

  // Natural heading perturbation (creates organic tunnels)
  // Less perturbation near surface to keep shaft tight
  if (Math.random() < (nearSurface ? 0.002 : B_BRANCH_CHANCE)) {
    ant.digAngle += (Math.random() - 0.5) * (nearSurface ? 0.2 : 0.6);
  }

  // Near surface: force strongly downward to create narrow entrance shaft
  if (nearSurface) {
    ant.digAngle += (Math.PI * 0.5 - ant.digAngle) * 0.25;
    // Hard constrain X to entrance column (prevents V-shape)
    if (state.entranceX > 0) {
      const targetX = state.entranceX * AF.CELL + AF.CELL / 2;
      const drift = Math.abs(ant.x - targetX);
      if (drift > AF.CELL * 2) {
        // Snap to shaft center when close to surface
        ant.x = targetX;
        ant.vx = 0;
      } else {
        ant.vx += (targetX - ant.x) * 0.1;
      }
    }
  }

  // Follow dig pheromone gradient (reinforces existing tunnels)
  if (s.digGrad.angle !== null && Math.random() < 0.3) {
    ant.digAngle += (s.digGrad.angle - ant.digAngle) * 0.1;
  }

  // Clamp dig angle: mostly downward (0.2 to 2.94 radians ≈ 10° to 170°)
  ant.digAngle = AF.clamp(ant.digAngle, 0.2, 2.94);

  // Blend heading toward dig angle
  ant.heading += (ant.digAngle - ant.heading) * 0.15;

  // Move in dig direction
  ant.vx += Math.cos(ant.heading) * spd * 0.35;
  ant.vy += Math.sin(ant.heading) * spd * 0.35;

  // Dig ahead
  if (ant.digCD <= 0) {
    const dgx = s.gx + Math.round(Math.cos(ant.heading) * 1.5);
    const dgy = s.gy + Math.round(Math.sin(ant.heading) * 1.5);
    if (AF.terrain.isSolid(state, dgx, dgy)) {
      const dug = AF.terrain.dig(state, dgx, dgy);
      if (dug) {
        ant.carryingSand++;
        ant.digCount++;
        ant.digCD = B_DIG_CD_BASE + (Math.random() * 6) | 0;
        ant.stuck = 0;
      }
    }
    // Also dig current cell if stuck in it
    if (AF.terrain.isSolid(state, s.gx, s.gy)) {
      AF.terrain.dig(state, s.gx, s.gy);
    }
    // Deep enough: dig wider (2nd cell in direction)
    if (!nearSurface && ant.digCount % 3 === 0) {
      const d2x = s.gx + Math.round(Math.cos(ant.heading) * 2.5);
      const d2y = s.gy + Math.round(Math.sin(ant.heading) * 2.5);
      if (AF.terrain.isSolid(state, d2x, d2y)) AF.terrain.dig(state, d2x, d2y);
    }
  }

  // Don't dig above surface
  if (s.atSurface) {
    ant.digAngle = Math.max(ant.digAngle, Math.PI * 0.4);
    ant.vy = Math.max(ant.vy, 0);
  }

  // Damping
  ant.vx *= 0.85;
  ant.vy *= 0.88;
}

function _moveUp(state, ant, s, spd) {
  // Head upward — prefer open cells above
  let bestAngle = -Math.PI * 0.5; // straight up
  let bestScore = -99;

  // Search 3-cell radius for best upward path
  for (let a = -Math.PI; a < Math.PI; a += 0.5) {
    if (a > 0.3 && a < 2.84) continue; // skip downward angles
    const cx = s.gx + Math.round(Math.cos(a) * 2);
    const cy = s.gy + Math.round(Math.sin(a) * 2);
    if (!AF.terrain.isSolid(state, cx, cy)) {
      const score = -cy * 3 + AF.pheromones.get(state, cx, cy, 'phTrail') * 2;
      if (score > bestScore) { bestScore = score; bestAngle = a; }
    }
  }

  ant.heading += (bestAngle - ant.heading) * 0.3;
  ant.vx += Math.cos(ant.heading) * spd * 0.4;
  ant.vy += Math.sin(ant.heading) * spd * 0.4;

  // Strong upward bias
  ant.vy -= spd * 0.15;

  // Damping
  ant.vx *= 0.85;
  ant.vy *= 0.88;
}

function _moveForage(state, ant, s, spd) {
  if (s.nearestFood) {
    // Move toward food
    const dx = s.nearestFood.x - ant.x;
    const dy = s.nearestFood.y - ant.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      ant.heading = Math.atan2(dy, dx);
      ant.vx += (dx / dist) * spd * 0.4;
      ant.vy += (dy / dist) * spd * 0.4;
    }
  } else if (s.foodGrad.angle !== null) {
    // Follow food pheromone
    ant.heading += (s.foodGrad.angle - ant.heading) * 0.15;
    ant.vx += Math.cos(ant.heading) * spd * 0.3;
    ant.vy += Math.sin(ant.heading) * spd * 0.3;
  } else {
    // Wander looking for food
    _moveExplore(state, ant, s, spd);
  }

  ant.vx *= 0.88;
  ant.vy *= 0.88;
}

function _moveExplore(state, ant, s, spd) {
  // Correlated random walk, weakly AGAINST trail pheromone (explore new areas)
  ant.meanderPhase += ant.meanderFreq;
  ant.heading += Math.sin(ant.meanderPhase) * 0.15;

  // Avoid trail pheromone (go to less-explored areas)
  if (s.trailGrad.angle !== null && Math.random() < 0.15) {
    // Turn away from strongest trail
    ant.heading += ((s.trailGrad.angle + Math.PI) - ant.heading) * 0.08;
  }

  // Avoid walls
  if (s.left) ant.heading -= 0.3;
  if (s.right) ant.heading += 0.3;
  if (s.below && !s.above) ant.heading -= 0.2; // prefer upward when blocked

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

  // Clamp velocity
  ant.vx = AF.clamp(ant.vx, -maxV, maxV);
  ant.vy = AF.clamp(ant.vy, -maxV, maxV);

  // Gravity when no ground below
  const gx = AF.ant.gx(ant);
  const gy = AF.ant.gy(ant);
  if (!AF.terrain.isSolid(state, gx, gy + 1) && gy < AF.ROWS - 1) {
    ant.vy += 0.2;
  }
  // Sliding friction on slopes
  if ((AF.terrain.isSolid(state, gx - 1, gy) || AF.terrain.isSolid(state, gx + 1, gy))
      && !AF.terrain.isSolid(state, gx, gy + 1)) {
    ant.vy *= 0.35;
  }

  // Apply velocity
  let nx = ant.x + ant.vx;
  let ny = ant.y + ant.vy;
  const ngx = (nx / AF.CELL) | 0;
  const ngy = (ny / AF.CELL) | 0;
  const digging = ant.state === AF.ST.DIG;

  // Collision with terrain (skip if digging — they dig through)
  if (AF.terrain.isSolid(state, ngx, ngy) && !digging) {
    // Try sliding along one axis
    if (!AF.terrain.isSolid(state, gx, ngy)) {
      nx = ant.x; ant.vx *= 0.15;
    } else if (!AF.terrain.isSolid(state, ngx, gy)) {
      ny = ant.y; ant.vy *= 0.15;
    } else {
      // Fully blocked
      nx = ant.x; ny = ant.y;
      ant.vx *= 0.05; ant.vy *= 0.05;
      ant.stuck++;
    }
  } else {
    if (ant.stuck > 0) ant.stuck = Math.max(0, ant.stuck - 1); // decay stuck counter
  }

  // Bounds
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
  // Teleport to nearest air cell directly above
  let gy = AF.ant.gy(ant);
  const gx = AF.ant.gx(ant);

  // Search upward for air
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
    // Search sideways too
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
    // Last resort: teleport to surface
    ant.x = gx * AF.CELL + AF.CELL / 2;
    ant.y = AF.SURFACE_PX - AF.CELL;
  }

  ant.vx = 0; ant.vy = 0; ant.stuck = 0;
  AF.ant.setThought(ant, 'Found my way out');
}

function _queenBehavior(state, ant) {
  const s = _sense(state, ant);
  ant.age++;

  // Queen stays near entrance on surface
  if (state.entranceX > 0) {
    const targetX = state.entranceX * AF.CELL + AF.CELL / 2;
    ant.vx += (targetX - ant.x) * 0.01;
  }

  // Stay on surface
  if (ant.y > AF.SURFACE_PX + AF.CELL) ant.vy -= 0.2;
  if (ant.y < AF.SURFACE_PX - AF.CELL * 3) ant.vy += 0.15;

  // Gentle wander
  ant.meanderPhase += 0.02;
  ant.vx += Math.sin(ant.meanderPhase) * 0.05;

  ant.vx *= 0.92;
  ant.vy *= 0.9;

  // Gravity
  if (!s.below) ant.vy += 0.15;

  ant.x += ant.vx;
  ant.y += ant.vy;
  ant.x = AF.clamp(ant.x, AF.FRAME + AF.CELL * 3, AF.W - AF.FRAME - AF.CELL * 3);
  ant.y = AF.clamp(ant.y, AF.SURFACE_PX - AF.CELL * 4, AF.SURFACE_PX + AF.CELL * 3);

  // Animation
  ant.legT += 0.08;
  ant.antT += 0.04;
  ant.bodyBob = Math.sin(ant.legT * 0.3) * 0.2;
  ant.state = AF.ST.IDLE;
  ant.role = 'queen';
}
