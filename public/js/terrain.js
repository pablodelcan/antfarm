// =====================================================================
//  ANTFARM v10 — Terrain: grid generation, digging, gravity, noise
// =====================================================================

'use strict';

AF.terrain = {};

// ── Noise functions ──

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

// Expose for renderer's sand noise
AF.terrain.smoothNoise = smoothNoise;
AF.terrain.hashN = hashN;
AF.terrain.fbm = fbm;

// ── Pixel hash for renderer ──
AF.terrain.pixelHash = function(x, y) {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xFF) / 255;
};

// ── Grid initialization ──

AF.terrain.init = function(state) {
  const { COLS, ROWS, SURFACE } = AF;
  state.grid = new Uint8Array(COLS * ROWS);
  state.phTrail = new Float32Array(COLS * ROWS);
  state.phFood = new Float32Array(COLS * ROWS);
  state.phDig = new Float32Array(COLS * ROWS);

  // Fill terrain with procedural sand
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (y < SURFACE) { state.grid[y * COLS + x] = 0; continue; }
      const d = (y - SURFACE) / (ROWS - SURFACE);
      const n = fbm(x * 0.04, y * 0.04) - 0.4;
      state.grid[y * COLS + x] = Math.max(1, Math.min(4, Math.round(1 + d * 2.5 + n * 1.0)));
    }
  }

  // Scatter a few bedrock patches
  for (let k = 0; k < 4; k++) {
    const cx = (Math.random() * (COLS - 14) + 7) | 0;
    const cy = (Math.random() * (ROWS - SURFACE - 20) + SURFACE + 14) | 0;
    const r = 2 + (Math.random() * 3) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < COLS && ny >= SURFACE && ny < ROWS) {
            state.grid[ny * COLS + nx] = 5;
          }
        }
      }
    }
  }

  state.terrainDirty = true;
};

// ── Cell queries ──

AF.terrain.cellAt = function(state, x, y) {
  const { COLS, ROWS } = AF;
  return (x < 0 || x >= COLS || y < 0 || y >= ROWS) ? 255 : state.grid[y * COLS + x];
};

AF.terrain.isSolid = function(state, x, y) {
  return AF.terrain.cellAt(state, x, y) > 0;
};

// ── Digging ──

AF.terrain.dig = function(state, x, y) {
  const { COLS, ROWS } = AF;
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 0;
  const i = y * COLS + x;
  if (!state.grid[i]) return 0;

  if (state.grid[i] <= 1) {
    state.grid[i] = 0;
    state.totalDug++;
    state.terrainDirty = true;
    // Reinforce immediate neighbors to prevent gravity erosion
    AF.terrain._reinforce(state, x, y);
    return 1;
  }
  // Hard material — weaken it
  state.grid[i]--;
  state.terrainDirty = true;
  return 1;
};

// Harden cardinal neighbors to prevent V-shape collapse
AF.terrain._reinforce = function(state, x, y) {
  const { COLS, ROWS } = AF;
  const dirs = [[-1, 0], [1, 0], [-1, -1], [1, -1], [0, -1], [0, -2]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
    const ni = ny * COLS + nx;
    if (state.grid[ni] > 0 && state.grid[ni] < 4) {
      state.grid[ni] = 4;
    }
  }
};

// ── Sand deposit (ant hauls sand to surface — builds crater mound beside entrance) ──
// Real ants create a volcano/crater shape: mounds rise on both sides of the
// entrance, with the hole itself kept clear at the center. Deposits are
// concentrated near the entrance (but not ON it), forming a natural cone.

AF.terrain.ENTRANCE_CLEAR_RADIUS = 2; // cells on each side of entrance kept open

AF.terrain.depositSand = function(state, gx) {
  const { COLS, ROWS, SURFACE } = AF;
  const entranceX = state.entranceX || gx;
  const clearR = AF.terrain.ENTRANCE_CLEAR_RADIUS;

  // Pick a random side (left or right of entrance)
  const side = Math.random() < 0.5 ? -1 : 1;

  // Crater/volcano distribution: most sand deposited close to the entrance
  // (just outside the clear zone), forming a natural mound that slopes away.
  // Use an exponential-ish distribution: offset = clearR+1 to clearR+18,
  // weighted toward the near side.
  const r = Math.random();
  const offset = clearR + 1 + Math.floor(r * r * 16); // quadratic bias toward near
  let nx = entranceX + side * offset;
  nx = Math.max(2, Math.min(COLS - 3, nx));

  // Safety: never deposit in the entrance clear zone
  if (Math.abs(nx - entranceX) <= clearR) return;

  // Find the topmost solid cell in this column near the surface
  let depositY = -1;
  for (let y = Math.max(0, SURFACE - 20); y < Math.min(ROWS, SURFACE + 3); y++) {
    if (state.grid[y * COLS + nx] > 0) {
      depositY = y - 1;
      break;
    }
  }

  if (depositY < 0) depositY = SURFACE - 1;

  // Don't build mounds too tall
  if (depositY < SURFACE - 15) return;

  if (depositY >= 0 && depositY < ROWS && !state.grid[depositY * COLS + nx]) {
    state.grid[depositY * COLS + nx] = 1;
    state.terrainDirty = true;
  }
};

// ── Entrance clearing — keep the entrance shaft open ──
// Runs periodically to remove any loose sand that drifted into the entrance zone
// (from gravity sliding). Real ants actively re-excavate their entrance.

AF.terrain.clearEntrance = function(state) {
  const { COLS, ROWS, SURFACE } = AF;
  const entranceX = state.entranceX;
  if (!entranceX || entranceX < 0) return;

  const clearR = AF.terrain.ENTRANCE_CLEAR_RADIUS;
  let changed = false;

  // Clear loose sand (hardness 1-2) above and at surface level in the entrance zone
  for (let x = entranceX - clearR; x <= entranceX + clearR; x++) {
    if (x < 0 || x >= COLS) continue;
    for (let y = Math.max(0, SURFACE - 20); y < SURFACE; y++) {
      const i = y * COLS + x;
      if (state.grid[i] > 0 && state.grid[i] <= 2) {
        state.grid[i] = 0;
        changed = true;
      }
    }
  }
  if (changed) state.terrainDirty = true;
};

// ── Gravity — loose sand (hardness 1-2) falls ──
// Starts above surface to handle mound physics

AF.terrain.gravity = function(state) {
  const { COLS, ROWS, SURFACE } = AF;
  const cellAt = AF.terrain.cellAt;
  const entranceX = state.entranceX;
  const clearR = AF.terrain.ENTRANCE_CLEAR_RADIUS;

  // Helper: is target cell in the entrance clear zone (above surface)?
  function inClearZone(tx, ty) {
    if (entranceX <= 0) return false;
    return ty < SURFACE && Math.abs(tx - entranceX) <= clearR;
  }

  for (let y = Math.min(ROWS - 2, SURFACE + 2); y >= Math.max(0, SURFACE - 20); y--) {
    for (let x = 0; x < COLS; x++) {
      const v = state.grid[y * COLS + x];
      if (!v || v > 2) continue;

      // If this sand grain is already in the clear zone, remove it (entrance clearing)
      if (inClearZone(x, y)) {
        state.grid[y * COLS + x] = 0;
        state.terrainDirty = true;
        continue;
      }

      if (!cellAt(state, x, y + 1)) {
        // Don't let sand fall into the entrance clear zone
        if (inClearZone(x, y + 1)) continue;
        state.grid[(y + 1) * COLS + x] = v;
        state.grid[y * COLS + x] = 0;
        state.terrainDirty = true;
      } else {
        const cl = !cellAt(state, x - 1, y + 1) && !cellAt(state, x - 1, y);
        const cr = !cellAt(state, x + 1, y + 1) && !cellAt(state, x + 1, y);
        if (cl && cr) {
          // Both sides open — pick the one NOT in the clear zone, or random
          const lClear = inClearZone(x - 1, y + 1);
          const rClear = inClearZone(x + 1, y + 1);
          let d;
          if (lClear && rClear) continue; // both sides in zone, don't slide
          else if (lClear) d = 1;
          else if (rClear) d = -1;
          else d = Math.random() < 0.5 ? -1 : 1;
          state.grid[(y + 1) * COLS + (x + d)] = v;
          state.grid[y * COLS + x] = 0;
          state.terrainDirty = true;
        } else if (cl && !inClearZone(x - 1, y + 1)) {
          state.grid[(y + 1) * COLS + (x - 1)] = v;
          state.grid[y * COLS + x] = 0;
          state.terrainDirty = true;
        } else if (cr && !inClearZone(x + 1, y + 1)) {
          state.grid[(y + 1) * COLS + (x + 1)] = v;
          state.grid[y * COLS + x] = 0;
          state.terrainDirty = true;
        }
      }
    }
  }
};
