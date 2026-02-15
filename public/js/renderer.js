// =====================================================================
//  ANTFARM v11 — Renderer: clean minimal style
//  Dark gray tunnels, flat gray sand, no silhouette, no frame
// =====================================================================

'use strict';

AF.renderer = {};

// Offscreen terrain canvas (cached between frames when terrain unchanged)
let _tOff, _tCtx, _terrainImageData;
// Offscreen mound overlay (above-surface terrain, rendered AFTER ants for depth)
let _mOff, _mCtx, _moundImageData;

AF.renderer.init = function(canvas) {
  _tOff = document.createElement('canvas');
  _tOff.width = AF.W;
  _tOff.height = AF.H;
  _tCtx = _tOff.getContext('2d');
  _terrainImageData = null;

  _mOff = document.createElement('canvas');
  _mOff.width = AF.W;
  _mOff.height = AF.H;
  _mCtx = _mOff.getContext('2d');
  _moundImageData = null;
};

// ═══════════════════════════════════════════════════════════════════
//  TERRAIN — flat gray sand with dark gray tunnels
// ═══════════════════════════════════════════════════════════════════

AF.renderer.terrain = function(ctx, state) {
  if (!state.grid) return;
  const { W, H, CELL, COLS, ROWS, SURFACE, SURFACE_PX, SAND_R, SAND_G, SAND_B } = AF;
  const grid = state.grid;

  function cellAt(x, y) {
    return (x < 0 || x >= COLS || y < 0 || y >= ROWS) ? 255 : grid[y * COLS + x];
  }

  if (!state.terrainDirty && _terrainImageData) {
    _tCtx.putImageData(_terrainImageData, 0, 0);
  } else {
    const tImg = _tCtx.createImageData(W, H);
    const d = tImg.data;
    const depthRange = H - SURFACE_PX;
    const pixelHash = AF.terrain.pixelHash;

    // Sky — adapts to light/dark theme
    const isLight = document.body.classList.contains('light');
    const skyR = isLight ? 232 : 255;
    const skyG = isLight ? 229 : 255;
    const skyB = isLight ? 224 : 255;
    for (let y = 0; y < SURFACE_PX; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        d[i] = skyR; d[i + 1] = skyG; d[i + 2] = skyB; d[i + 3] = 255;
      }
    }

    // Sand mounds above surface — SKIPPED here, drawn as overlay after ants
    // (so mounds appear in front of ants for depth effect)

    // Ground — flat gray sand with subtle noise
    for (let py = SURFACE_PX; py < H; py++) {
      const gy = (py / CELL) | 0;
      const depthFactor = (py - SURFACE_PX) / depthRange;

      for (let px = 0; px < W; px++) {
        const gx = (px / CELL) | 0;
        const i = (py * W + px) * 4;
        const v = cellAt(gx, gy);

        if (v > 0) {
          // Solid sand — flat gray with very subtle depth darkening
          const darkening = 1 - depthFactor * 0.03;
          const noise = (pixelHash(px, py) - 0.5) * 4;
          const r = (SAND_R + noise) * darkening;
          const g = (SAND_G + noise) * darkening;
          const b = (SAND_B + noise) * darkening;

          d[i]     = Math.max(0, Math.min(255, r)) | 0;
          d[i + 1] = Math.max(0, Math.min(255, g)) | 0;
          d[i + 2] = Math.max(0, Math.min(255, b)) | 0;
          d[i + 3] = 255;
        } else {
          // Tunnel — near black for B&W palette
          d[i]     = AF.TUNNEL_R;
          d[i + 1] = AF.TUNNEL_G;
          d[i + 2] = AF.TUNNEL_B;
          d[i + 3] = 255;
        }
      }
    }

    _tCtx.putImageData(tImg, 0, 0);
    _terrainImageData = _tCtx.getImageData(0, 0, W, H);

    // Build mound overlay (above-surface terrain only, on transparent background)
    const mImg = _mCtx.createImageData(W, H);
    const md = mImg.data;
    for (let py = Math.max(0, SURFACE_PX - 50); py < SURFACE_PX; py++) {
      const gy = (py / CELL) | 0;
      for (let px = 0; px < W; px++) {
        const gx = (px / CELL) | 0;
        const v = cellAt(gx, gy);
        if (v > 0) {
          const mi = (py * W + px) * 4;
          const noise = (pixelHash(px, py) - 0.5) * 4;
          md[mi]     = Math.min(255, SAND_R + noise) | 0;
          md[mi + 1] = Math.min(255, SAND_G + noise) | 0;
          md[mi + 2] = Math.min(255, SAND_B + noise) | 0;
          md[mi + 3] = 255;
        }
      }
    }
    _mCtx.putImageData(mImg, 0, 0);
    _moundImageData = _mCtx.getImageData(0, 0, W, H);

    state.terrainDirty = false;
  }

  ctx.drawImage(_tOff, 0, 0);
};

// Draw surface mounds as overlay (called AFTER ants for depth effect)
AF.renderer.surfaceMounds = function(ctx, state) {
  if (!_moundImageData) return;
  _mCtx.putImageData(_moundImageData, 0, 0);
  ctx.drawImage(_mOff, 0, 0);
};

// ═══════════════════════════════════════════════════════════════════
//  FRAME — none (clean card handles the border)
// ═══════════════════════════════════════════════════════════════════

AF.renderer.frame = function(ctx) {
  // No frame — the CSS card handles the container
};

// ═══════════════════════════════════════════════════════════════════
//  SILHOUETTE — disabled (no-op)
// ═══════════════════════════════════════════════════════════════════

AF.renderer.silhouette = function(ctx) {
};

// ═══════════════════════════════════════════════════════════════════
//  GLASS — disabled (no-op)
// ═══════════════════════════════════════════════════════════════════

AF.renderer.glass = function(ctx) {
};

// ═══════════════════════════════════════════════════════════════════
//  FOOD (surface and underground)
// ═══════════════════════════════════════════════════════════════════

AF.renderer.food = function(ctx, foods, foodStores) {
  // Surface food
  if (foods) {
    for (const f of foods) {
      _drawFoodCluster(ctx, f, 'rgba(60,60,60,0.7)');
    }
  }
  // Underground food stores (slightly lighter to distinguish)
  if (foodStores) {
    for (const f of foodStores) {
      _drawFoodCluster(ctx, f, 'rgba(90,90,90,0.8)');
    }
  }
};

function _drawFoodCluster(ctx, f, color) {
  const amt = f.amount || 3;
  const baseR = 4 + amt * 0.8;
  const seed = (f.x * 137 + f.y * 269) | 0;
  const crumbCount = Math.min(amt * 2 + 3, 16);
  ctx.fillStyle = color;
  for (let i = 0; i < crumbCount; i++) {
    const h = ((seed + i * 7919) * 2654435761) >>> 0;
    const cx = f.x + ((h & 0xFF) / 255 - 0.5) * baseR * 2;
    const cy = f.y + (((h >> 8) & 0xFF) / 255 - 0.5) * baseR * 1.5;
    const sz = 1.5 + ((h >> 16) & 0x1);
    ctx.fillRect(Math.round(cx), Math.round(cy), sz, sz);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  BROOD — eggs, larvae, pupae rendered in tunnels
// ═══════════════════════════════════════════════════════════════════

AF.renderer.brood = function(ctx, brood) {
  if (!brood) return;
  for (const b of brood) {
    const bx = Math.round(b.x), by = Math.round(b.y);

    if (b.stage === AF.BROOD.EGG) {
      // Eggs: tiny white pixel cluster
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(bx, by - 1, 2, 3);
    } else if (b.stage === AF.BROOD.LARVA) {
      // Larvae: slightly larger, light gray block
      const fed = b.fed || 0;
      const sz = 2 + fed;
      ctx.fillStyle = 'rgba(220,220,220,0.9)';
      ctx.fillRect(bx - 1, by - 1, sz, sz);
      // Darker center pixel
      ctx.fillStyle = 'rgba(140,140,140,0.6)';
      ctx.fillRect(bx, by, 1, 1);
    } else if (b.stage === AF.BROOD.PUPA) {
      // Pupae: medium gray pixel capsule
      ctx.fillStyle = 'rgba(180,180,180,0.9)';
      ctx.fillRect(bx - 1, by - 2, 3, 5);
      // Segmentation lines
      ctx.fillStyle = 'rgba(120,120,120,0.5)';
      ctx.fillRect(bx - 1, by - 1, 3, 1);
      ctx.fillRect(bx - 1, by + 1, 3, 1);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
//  CHAMBER LABELS — subtle type indicators
// ═══════════════════════════════════════════════════════════════════

AF.renderer.chamberLabels = function(ctx, chambers) {
  if (!chambers) return;

  const ICONS = {
    royal: '\u2655',    // crown
    brood: '\u2022',    // dot (nursery)
    food: '\u2022',     // dot (granary)
    midden: '\u2022',   // dot (waste)
  };

  const COLORS = {
    royal: 'rgba(255,220,150,0.22)',
    brood: 'rgba(200,220,255,0.18)',
    food: 'rgba(180,255,180,0.18)',
    midden: 'rgba(130,130,130,0.15)',
  };

  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';

  for (const c of chambers) {
    if (!c.type || c.type === AF.CHAMBER_TYPE.GENERAL) continue;

    const color = COLORS[c.type];
    if (!color) continue;

    // Subtle glow around chamber center
    const r = Math.sqrt(c.size) * AF.CELL * 0.3;
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, 6.28);
    ctx.fill();

    // Small label
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.6)');
    const label = c.type === 'royal' ? '\u265B' : c.type === 'brood' ? 'N' : c.type === 'food' ? 'F' : 'W';
    ctx.fillText(label, c.x, c.y - r * 0.5 - 2);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════════════════

AF.renderer.particles = function(ctx, particles, terrainParticles) {
  for (const p of particles) {
    const a = Math.max(0, p.life / 35);
    ctx.fillStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${a.toFixed(2)})`;
    const sz = Math.ceil(p.size);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
  }
  for (const p of terrainParticles) {
    const a = Math.max(0, p.life / 50);
    ctx.fillStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${a.toFixed(2)})`;
    const sz = Math.ceil(p.size);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  ANT POSTURE — adapted for 8-state system
// ═══════════════════════════════════════════════════════════════════

AF.renderer.getPosture = function(ant) {
  const s = ant.state;
  const ST = AF.ST;

  if (s === ST.DIG) {
    return {
      bodyTilt: -0.35 - Math.sin(Date.now() * 0.008) * 0.1,
      legSpeed: 1.5,
      mandibleOpen: 0.25 + Math.sin(Date.now() * 0.012) * 0.15,
      headDip: 0.3,
      abdomenPulse: 1.0 + Math.sin(Date.now() * 0.006) * 0.08,
      antennaSpeed: 1.2,
      animateWhenStill: true,
      dustChance: 0.15
    };
  }
  if (s === ST.HAUL || s === ST.CARRY) {
    return {
      bodyTilt: 0.15, legSpeed: 0.6, mandibleOpen: 0,
      headDip: -0.2, abdomenPulse: 1.0, antennaSpeed: 0.7,
      animateWhenStill: false, dustChance: 0
    };
  }
  if (s === ST.REST) {
    return {
      bodyTilt: 0, legSpeed: 0, mandibleOpen: 0,
      headDip: 0.1, abdomenPulse: 1.0 + Math.sin(Date.now() * 0.003) * 0.05,
      antennaSpeed: 0.3, animateWhenStill: true, dustChance: 0
    };
  }
  if (s === ST.EXPLORE) {
    return {
      bodyTilt: -0.05, legSpeed: 1.1, mandibleOpen: 0.02,
      headDip: 0, abdomenPulse: 1.0, antennaSpeed: 2.0,
      animateWhenStill: false, dustChance: 0
    };
  }
  if (s === ST.NURSE) {
    return {
      bodyTilt: -0.1, legSpeed: 0.8, mandibleOpen: 0.08,
      headDip: 0.15, abdomenPulse: 1.0 + Math.sin(Date.now() * 0.004) * 0.04,
      antennaSpeed: 1.5, animateWhenStill: true, dustChance: 0
    };
  }
  return {
    bodyTilt: 0, legSpeed: 1.0, mandibleOpen: 0,
    headDip: 0, abdomenPulse: 1.0, antennaSpeed: 1.0,
    animateWhenStill: false, dustChance: 0
  };
};

// ═══════════════════════════════════════════════════════════════════
//  ANT — detailed side-view rendering
// ═══════════════════════════════════════════════════════════════════

AF.renderer.ant = function(ctx, ant, hoveredAnt, particles) {
  const x = ant.x, y = ant.y + (ant.bodyBob || 0);
  const s = ant.size * 1.4;
  const mov = Math.hypot(ant.vx, ant.vy) > 0.08;
  const posture = AF.renderer.getPosture(ant);
  const { SAND_R, SAND_G, SAND_B } = AF;

  // Pixel unit — each "ant pixel" maps to ~1.4 screen pixels
  const p = s * 0.24;

  // Compute visual rotation from smoothed display angle
  let visualAngle = ant.displayAngle || 0;
  let facingRight = 1;
  if (Math.abs(visualAngle) > Math.PI / 2) {
    facingRight = -1;
    visualAngle = visualAngle > 0 ? Math.PI - visualAngle : -(Math.PI + visualAngle);
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facingRight, 1);
  ctx.rotate(visualAngle);
  if (posture.bodyTilt) ctx.rotate(posture.bodyTilt);

  // Body color varies with hunger — starving ants look pale/weak
  let bk;
  if (ant.state === AF.ST.HUNGRY && ant.energy < 150) {
    bk = '#666'; // critically starving — very pale
  } else if (ant.state === AF.ST.HUNGRY) {
    bk = '#444'; // hungry — noticeably lighter
  } else {
    bk = '#1a1a1a'; // healthy — dark
  }
  const pp = p + 0.5; // pixel draw size (slight overlap prevents gaps)

  // Helper: draw one ant-pixel at sprite grid coords
  function dot(gx, gy, c) {
    ctx.fillStyle = c || bk;
    ctx.fillRect(gx * p, gy * p, pp, pp);
  }

  // ── ABDOMEN (teardrop, leftmost) ──
  dot(-5, 0);
  dot(-4, -1); dot(-4, 0); dot(-4, 1);
  dot(-3, -1); dot(-3, 0); dot(-3, 1);
  dot(-2, 0);
  // Breathing pulse: extra pixel
  if ((posture.abdomenPulse || 1) > 1.03) dot(-5, -1);

  // ── PETIOLE ──
  dot(-1, 0);

  // ── THORAX (legs attach here) ──
  dot(0, -1); dot(0, 0);
  dot(1, -1); dot(1, 0);
  dot(2, 0);

  // ── HEAD ──
  dot(3, -1); dot(3, 0);
  dot(4, 0);

  // ── EYE (white pixel) ──
  dot(4, -1, '#fff');

  // ── MANDIBLES ──
  const mO = posture.mandibleOpen || 0;
  if (mO > 0.15) {
    dot(5, -1); dot(5, 1); // open
  } else {
    dot(5, 0); // closed
  }

  // ── ANTENNAE (two, with bobbing) ──
  const aT = ant.antT || 0;
  const ab1 = Math.sin(aT) > 0.3 ? 0 : -1;
  const ab2 = Math.sin(aT + 1.2) > 0.3 ? 0 : -1;
  dot(4, -2);               // base
  dot(5, -3 + ab1);         // upper tip
  dot(5, -2 + ab2);         // lower tip

  // ── LEGS (tripod gait animation) ──
  // All 6 legs attach to thorax (x = -1 to 2)
  const la = mov || posture.animateWhenStill;
  if (la && Math.sin(ant.legT || 0) > 0) {
    // Frame A: rear back, front forward
    dot(-1, 1); dot(-2, 2); dot(-3, 3);   // rear pair
    dot(1, 1);  dot(1, 2);  dot(1, 3);    // middle pair
    dot(2, 1);  dot(3, 2);  dot(4, 3);    // front pair
  } else if (la) {
    // Frame B: rear forward, front back
    dot(-1, 1); dot(0, 2);  dot(1, 3);    // rear pair
    dot(1, 1);  dot(1, 2);  dot(1, 3);    // middle pair
    dot(2, 1);  dot(1, 2);  dot(0, 3);    // front pair
  } else {
    // Static: legs straight down
    dot(-1, 1); dot(-1, 2); dot(-1, 3);   // rear pair
    dot(1, 1);  dot(1, 2);  dot(1, 3);    // middle pair
    dot(2, 1);  dot(2, 2);  dot(2, 3);    // front pair
  }

  // ── CARRIED SAND ──
  if (ant.carryingSand > 0) {
    const sc = `rgb(${SAND_R},${SAND_G},${SAND_B})`;
    dot(5, -1, sc); dot(6, 0, sc);
    if (ant.carryingSand > 3) dot(6, -1, sc);
  }

  // ── CARRIED FOOD ──
  if (ant.carrying || ant.carryingFood > 0) {
    dot(5, -1, '#555'); dot(6, 0, '#555');
  }

  // ── QUEEN MARKER (white crown pixels) ──
  if (ant.isQueen) {
    dot(0, -2, '#fff'); dot(1, -2, '#fff');
  }

  // ── HOVER HIGHLIGHT ──
  if (hoveredAnt === ant) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(-6 * p, -4 * p, 13 * p, 8 * p);
  }

  // ── DIG DUST (pixel particles) ──
  if (posture.dustChance > 0 && Math.random() < posture.dustChance && mov && particles) {
    particles.push({
      x: ant.x + (facingRight * s * 1.5), y: ant.y + s * 0.3,
      vx: (Math.random() - 0.5) * 1.5 * facingRight, vy: Math.random() * -1.2 - 0.3,
      life: 15 + Math.random() * 10, size: 1,
      r: SAND_R, g: SAND_G, b: SAND_B
    });
  }

  ctx.restore();
};

// ═══════════════════════════════════════════════════════════════════
//  FALLING OBJECTS — drop-in animation for admin actions
// ═══════════════════════════════════════════════════════════════════

AF.renderer.fallingObjects = function(ctx, objects) {
  for (const f of objects) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rotation);
    if (f.type === 'ant') {
      // Pixel art tumbling ant
      const px = 1.5;
      ctx.fillStyle = '#1a1a1a';
      const dots = [[-4,0],[-3,-1],[-3,0],[-3,1],[-2,0],[-1,0],[0,-1],[0,0],[1,-1],[1,0],[2,0],[3,-1],[3,0]];
      for (const d of dots) ctx.fillRect(d[0] * px, d[1] * px, px + 0.5, px + 0.5);
      // Eye
      ctx.fillStyle = '#fff';
      ctx.fillRect(3 * px, -1 * px, px + 0.5, px + 0.5);
      // Legs (splayed)
      ctx.fillStyle = '#1a1a1a';
      const legs = [[-2,1],[-3,2],[0,1],[0,2],[2,1],[3,2]];
      for (const d of legs) ctx.fillRect(d[0] * px, d[1] * px, px + 0.5, px + 0.5);
    } else if (f.type === 'food') {
      ctx.fillStyle = f.color || '#555';
      ctx.fillRect(-1, -1, 3, 3);
    }
    ctx.restore();
  }
};
