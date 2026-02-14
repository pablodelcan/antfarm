// =====================================================================
//  ANTFARM v10 — Pheromone maps: deposit, decay, gradient sensing
// =====================================================================

'use strict';

AF.pheromones = {};

// Deposit pheromone at grid position
AF.pheromones.set = function(state, x, y, value, mapName) {
  const { COLS, ROWS } = AF;
  const m = state[mapName];
  if (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
    m[y * COLS + x] = Math.min(1.5, m[y * COLS + x] + value);
  }
};

// Read pheromone at grid position
AF.pheromones.get = function(state, x, y, mapName) {
  const { COLS, ROWS } = AF;
  const m = state[mapName];
  return (x >= 0 && x < COLS && y >= 0 && y < ROWS) ? m[y * COLS + x] : 0;
};

// Decay all pheromone maps (call every few frames)
AF.pheromones.decay = function(state) {
  const len = state.phTrail.length;
  for (let i = 0; i < len; i++) {
    state.phTrail[i] *= 0.993;
    state.phFood[i]  *= 0.996;
    state.phDig[i]   *= 0.99;
    if (state.phTrail[i] < 0.003) state.phTrail[i] = 0;
    if (state.phFood[i]  < 0.003) state.phFood[i]  = 0;
    if (state.phDig[i]   < 0.003) state.phDig[i]   = 0;
  }
};

// Find direction of strongest pheromone gradient
// Returns { angle: radians|null, strength: number }
AF.pheromones.gradient = function(state, gx, gy, mapName, radius) {
  const r = radius || 5;
  let bestVal = AF.pheromones.get(state, gx, gy, mapName);
  let bestAngle = null;
  // Sample 12 directions
  for (let a = 0; a < 6.28; a += 0.524) {
    const cx = gx + Math.round(Math.cos(a) * r);
    const cy = gy + Math.round(Math.sin(a) * r);
    const v = AF.pheromones.get(state, cx, cy, mapName);
    if (v > bestVal + 0.01) {
      bestVal = v;
      bestAngle = a;
    }
  }
  return { angle: bestAngle, strength: bestVal };
};

// Sense total pheromone in nearby area (for saturation detection)
AF.pheromones.nearby = function(state, gx, gy, mapName, radius) {
  const r = radius || 3;
  let total = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        total += AF.pheromones.get(state, gx + dx, gy + dy, mapName);
      }
    }
  }
  return total;
};
