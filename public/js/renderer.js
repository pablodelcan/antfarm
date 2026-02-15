// =====================================================================
//  ANTFARM v11 — Renderer: clean minimal style
//  Dark gray tunnels, flat gray sand, no silhouette, no frame
// =====================================================================

'use strict';

AF.renderer = {};

// Offscreen terrain canvas (cached between frames when terrain unchanged)
let _tOff, _tCtx, _terrainImageData;

AF.renderer.init = function(canvas) {
  _tOff = document.createElement('canvas');
  _tOff.width = AF.W;
  _tOff.height = AF.H;
  _tCtx = _tOff.getContext('2d');
  _terrainImageData = null;
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

    // Sky — clean white
    for (let y = 0; y < SURFACE_PX; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      }
    }

    // Sand mounds above surface — same sand color
    for (let py = Math.max(0, SURFACE_PX - 50); py < SURFACE_PX; py++) {
      const gy = (py / CELL) | 0;
      for (let px = 0; px < W; px++) {
        const gx = (px / CELL) | 0;
        const v = cellAt(gx, gy);
        if (v > 0) {
          const i = (py * W + px) * 4;
          const pixHash = pixelHash(px, py);
          const noise = (pixHash - 0.5) * 4;
          d[i]     = Math.min(255, SAND_R + noise) | 0;
          d[i + 1] = Math.min(255, SAND_G + noise) | 0;
          d[i + 2] = Math.min(255, SAND_B + noise) | 0;
          d[i + 3] = 255;
        }
      }
    }

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
          // Tunnel — dark earthy gray
          d[i]     = 90;
          d[i + 1] = 85;
          d[i + 2] = 80;
          d[i + 3] = 255;
        }
      }
    }

    _tCtx.putImageData(tImg, 0, 0);
    _terrainImageData = _tCtx.getImageData(0, 0, W, H);
    state.terrainDirty = false;
  }

  ctx.drawImage(_tOff, 0, 0);
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
  for (const f of foods) {
    _drawFoodCluster(ctx, f, 'rgba(80,70,55,0.7)');
  }
  // Underground food stores (slightly different color to distinguish)
  if (foodStores) {
    for (const f of foodStores) {
      _drawFoodCluster(ctx, f, 'rgba(120,90,40,0.8)');
    }
  }
};

function _drawFoodCluster(ctx, f, color) {
  const amt = f.amount || 3;
  const baseR = 3 + amt * 0.6;
  const seed = (f.x * 137 + f.y * 269) | 0;
  const crumbCount = Math.min(amt + 2, 8);
  for (let i = 0; i < crumbCount; i++) {
    const h = ((seed + i * 7919) * 2654435761) >>> 0;
    const cx = f.x + ((h & 0xFF) / 255 - 0.5) * baseR * 2;
    const cy = f.y + (((h >> 8) & 0xFF) / 255 - 0.5) * baseR * 1.5;
    const cr = 1 + ((h >> 16) & 0x3) * 0.5;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.28); ctx.fill();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  BROOD — eggs, larvae, pupae rendered in tunnels
// ═══════════════════════════════════════════════════════════════════

AF.renderer.brood = function(ctx, brood) {
  if (!brood) return;
  for (const b of brood) {
    const x = b.x, y = b.y;

    if (b.stage === AF.BROOD.EGG) {
      // Eggs: tiny white ovals
      ctx.fillStyle = 'rgba(240,235,220,0.9)';
      ctx.beginPath();
      ctx.ellipse(x, y, 1.5, 2.2, 0, 0, 6.28);
      ctx.fill();
    } else if (b.stage === AF.BROOD.LARVA) {
      // Larvae: slightly larger, cream-colored, C-shaped
      const fed = b.fed || 0;
      const size = 2.0 + fed * 0.4;
      ctx.fillStyle = 'rgba(245,235,200,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 6.28);
      ctx.fill();
      // Darker center
      ctx.fillStyle = 'rgba(220,200,160,0.6)';
      ctx.beginPath();
      ctx.arc(x + 0.5, y - 0.3, size * 0.4, 0, 6.28);
      ctx.fill();
    } else if (b.stage === AF.BROOD.PUPA) {
      // Pupae: darker, more defined shape, cocoon-like
      ctx.fillStyle = 'rgba(200,185,150,0.9)';
      ctx.beginPath();
      ctx.ellipse(x, y, 2.2, 3.0, 0.2, 0, 6.28);
      ctx.fill();
      // Segmentation lines
      ctx.strokeStyle = 'rgba(170,155,120,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x - 1.5, y - 0.5);
      ctx.lineTo(x + 1.5, y - 0.5);
      ctx.moveTo(x - 1.5, y + 0.8);
      ctx.lineTo(x + 1.5, y + 0.8);
      ctx.stroke();
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
    royal: 'rgba(200,170,50,0.35)',
    brood: 'rgba(180,150,200,0.30)',
    food: 'rgba(120,160,80,0.30)',
    midden: 'rgba(140,120,100,0.25)',
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
    const label = c.type === 'royal' ? 'Q' : c.type === 'brood' ? 'N' : c.type === 'food' ? 'F' : 'W';
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
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.28); ctx.fill();
  }
  for (const p of terrainParticles) {
    const a = Math.max(0, p.life / 50);
    ctx.fillStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${a.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.28); ctx.fill();
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
  let s = ant.size * 1.4;
  const facingRight = ant.vx >= 0 ? 1 : -1;
  const mov = Math.hypot(ant.vx, ant.vy) > 0.08;
  const posture = AF.renderer.getPosture(ant);
  const { SAND_R, SAND_G, SAND_B } = AF;
  const col = '#1a1a1a';

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facingRight, 1);
  if (posture.bodyTilt) ctx.rotate(posture.bodyTilt);

  // LEGS
  ctx.strokeStyle = col;
  ctx.lineWidth = s * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const tripodOffset = (i === 1) ? Math.PI : 0;
    const phase = (mov || posture.legSpeed > 0) ? Math.sin(ant.legT + tripodOffset) * posture.legSpeed : 0;
    const attachX = -s * 0.3 + i * s * 0.65;
    const attachY = s * 0.1;
    const kneeX = attachX + phase * s * 0.2;
    const kneeY = attachY + s * 0.55;
    const footX = kneeX + (i - 1) * s * 0.15 + phase * s * 0.3;
    const footY = attachY + s * 1.1 + Math.abs(phase) * s * 0.1;
    ctx.beginPath(); ctx.moveTo(attachX, attachY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(footX - s * 0.1, footY); ctx.lineTo(footX + s * 0.15, footY + s * 0.04); ctx.stroke();
  }

  // ABDOMEN
  const abdX = -s * 0.9, abdY = -s * 0.05;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(abdX, abdY, s * 0.95, s * 0.6 * (posture.abdomenPulse || 1), -0.1, 0, 6.28); ctx.fill();

  // PETIOLE
  ctx.beginPath(); ctx.ellipse(-s * 0.05, 0, s * 0.13, s * 0.1, 0, 0, 6.28); ctx.fill();

  // THORAX
  const thX = s * 0.3, thY = -s * 0.03;
  ctx.beginPath(); ctx.ellipse(thX, thY, s * 0.4, s * 0.3, -0.15, 0, 6.28); ctx.fill();

  // HEAD
  const headDip = posture.headDip || 0;
  const hdX = s * 0.85, hdY = s * 0.02 + headDip * s;
  ctx.beginPath(); ctx.ellipse(hdX, hdY, s * 0.35, s * 0.3, 0.1, 0, 6.28); ctx.fill();

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(hdX + s * 0.14, hdY - s * 0.06, s * 0.06, 0, 6.28); ctx.fill();

  // MANDIBLES
  ctx.strokeStyle = col; ctx.lineWidth = s * 0.18; ctx.lineCap = 'round';
  const mO = posture.mandibleOpen + (mov ? Math.sin(ant.legT * 0.5) * 0.04 : 0);
  ctx.beginPath(); ctx.moveTo(hdX + s * 0.25, hdY - s * 0.08); ctx.lineTo(hdX + s * 0.6, hdY - s * 0.2 - mO * s * 0.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hdX + s * 0.25, hdY + s * 0.08); ctx.lineTo(hdX + s * 0.6, hdY + s * 0.2 + mO * s * 0.8); ctx.stroke();

  // Sand grain (gray to match sand)
  if (ant.carryingSand > 0) {
    const grainSize = s * (0.18 + ant.carryingSand * 0.04);
    ctx.fillStyle = `rgb(${SAND_R},${SAND_G},${SAND_B})`;
    ctx.beginPath(); ctx.arc(hdX + s * 0.5, hdY, grainSize, 0, 6.28); ctx.fill();
  }

  // ANTENNAE (two for realism)
  ctx.strokeStyle = col; ctx.lineWidth = s * 0.12;
  const antBob = Math.sin(ant.antT) * 0.12;
  // Upper antenna
  ctx.beginPath();
  ctx.moveTo(hdX + s * 0.15, hdY - s * 0.2);
  ctx.quadraticCurveTo(hdX + s * 0.35, hdY - s * 0.65 + antBob * s, hdX + s * 0.65, hdY - s * 0.75 + antBob * s);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(hdX + s * 0.65, hdY - s * 0.75 + antBob * s, s * 0.06, 0, 6.28); ctx.fill();
  // Lower antenna (mirrored)
  const antBob2 = Math.sin(ant.antT + 0.8) * 0.10;
  ctx.beginPath();
  ctx.moveTo(hdX + s * 0.15, hdY - s * 0.1);
  ctx.quadraticCurveTo(hdX + s * 0.4, hdY - s * 0.5 + antBob2 * s, hdX + s * 0.7, hdY - s * 0.55 + antBob2 * s);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(hdX + s * 0.7, hdY - s * 0.55 + antBob2 * s, s * 0.05, 0, 6.28); ctx.fill();

  // Food (foraging or nurse carrying)
  if (ant.carrying || ant.carryingFood > 0) {
    ctx.fillStyle = ant.carryingFood > 0 ? '#8a7a30' : '#5a8a30';
    ctx.beginPath(); ctx.arc(hdX + s * 0.45, hdY - s * 0.05, s * 0.25, 0, 6.28); ctx.fill();
  }

  // Queen marker
  if (ant.isQueen) {
    ctx.fillStyle = 'rgba(200,170,50,0.6)';
    ctx.beginPath(); ctx.arc(thX, thY - s * 0.5, s * 0.15, 0, 6.28); ctx.fill();
  }

  // Hover highlight
  if (hoveredAnt === ant) {
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 2.2, s * 1.5, 0, 0, 6.28); ctx.stroke();
  }

  // Dig dust (gray particles)
  if (posture.dustChance > 0 && Math.random() < posture.dustChance && mov && particles) {
    particles.push({
      x: ant.x + (facingRight * s * 1.5), y: ant.y + s * 0.3,
      vx: (Math.random() - 0.5) * 1.5 * facingRight, vy: Math.random() * -1.2 - 0.3,
      life: 15 + Math.random() * 10, size: 0.8 + Math.random() * 0.8,
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
      const s = 3.5;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.ellipse(-s * 0.9, 0, s * 0.9, s * 0.55, 0, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.12, s * 0.1, 0, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 0.3, 0, s * 0.35, s * 0.28, 0, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 0.75, 0, s * 0.3, s * 0.25, 0, 0, 6.28); ctx.fill();
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = s * 0.18;
      for (let i = 0; i < 3; i++) {
        const lx = -s * 0.3 + i * s * 0.5;
        ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx - s * 0.4, s * 0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx + s * 0.3, -s * 0.7); ctx.stroke();
      }
    } else if (f.type === 'food') {
      ctx.fillStyle = f.color || '#7a6a50';
      ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 6.28); ctx.fill();
    }
    ctx.restore();
  }
};
