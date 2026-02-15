// =====================================================================
//  ANTFARM v11 — Renderer: clean minimal style
//  White tunnels, flat gray sand, black silhouette trees, no frame
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
//  TERRAIN — flat gray sand with white tunnels
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

    // Sand mounds above surface
    for (let py = Math.max(0, SURFACE_PX - 50); py < SURFACE_PX; py++) {
      const gy = (py / CELL) | 0;
      for (let px = 0; px < W; px++) {
        const gx = (px / CELL) | 0;
        const v = cellAt(gx, gy);
        if (v > 0) {
          const i = (py * W + px) * 4;
          const pixHash = pixelHash(px, py);
          const noise = (pixHash - 0.5) * 6;
          d[i]     = Math.min(255, SAND_R + 4 + noise) | 0;
          d[i + 1] = Math.min(255, SAND_G + 4 + noise) | 0;
          d[i + 2] = Math.min(255, SAND_B + 4 + noise) | 0;
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
          const darkening = 1 - depthFactor * 0.08;
          const noise = (pixelHash(px, py) - 0.5) * 4;
          const r = (SAND_R + noise) * darkening;
          const g = (SAND_G + noise) * darkening;
          const b = (SAND_B + noise) * darkening;

          d[i]     = Math.max(0, Math.min(255, r)) | 0;
          d[i + 1] = Math.max(0, Math.min(255, g)) | 0;
          d[i + 2] = Math.max(0, Math.min(255, b)) | 0;
          d[i + 3] = 255;
        } else {
          // Tunnel — WHITE (bright, clean)
          d[i]     = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
          d[i + 3] = 255;
        }
      }
    }

    // Subtle tunnel edge softening — only 1px border blend at edges
    for (let py = SURFACE_PX; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const gx = (px / CELL) | 0;
        const gy = (py / CELL) | 0;
        const v = cellAt(gx, gy);
        if (v > 0) {
          const subX = px % CELL;
          const subY = py % CELL;
          // Only blend the outermost pixel of each cell edge
          let blend = 0;
          if (subX === 0 && gx > 0 && !cellAt(gx - 1, gy)) blend = 0.25;
          else if (subX === CELL - 1 && gx < COLS - 1 && !cellAt(gx + 1, gy)) blend = 0.25;
          if (subY === 0 && gy > 0 && !cellAt(gx, gy - 1)) blend = Math.max(blend, 0.25);
          else if (subY === CELL - 1 && gy < ROWS - 1 && !cellAt(gx, gy + 1)) blend = Math.max(blend, 0.25);
          // Corner blend
          if (subX === 0 && subY === 0 && gx > 0 && gy > 0 && !cellAt(gx - 1, gy - 1)) blend = Math.max(blend, 0.15);
          if (subX === CELL - 1 && subY === 0 && gx < COLS - 1 && gy > 0 && !cellAt(gx + 1, gy - 1)) blend = Math.max(blend, 0.15);
          if (subX === 0 && subY === CELL - 1 && gx > 0 && gy < ROWS - 1 && !cellAt(gx - 1, gy + 1)) blend = Math.max(blend, 0.15);
          if (subX === CELL - 1 && subY === CELL - 1 && gx < COLS - 1 && gy < ROWS - 1 && !cellAt(gx + 1, gy + 1)) blend = Math.max(blend, 0.15);
          if (blend > 0) {
            const i = (py * W + px) * 4;
            d[i]     = Math.min(255, d[i] + (255 - d[i]) * blend) | 0;
            d[i + 1] = Math.min(255, d[i + 1] + (255 - d[i + 1]) * blend) | 0;
            d[i + 2] = Math.min(255, d[i + 2] + (255 - d[i + 2]) * blend) | 0;
          }
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
//  SILHOUETTE — black trees and grass, varied shapes
// ═══════════════════════════════════════════════════════════════════

AF.renderer.silhouette = function(ctx) {
  const { SURFACE_PX, W } = AF;
  const y = SURFACE_PX;

  ctx.save();

  // Ground line — thin black
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(W, y);
  ctx.stroke();

  // Small grass tufts along ground
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  for (let gx = 10; gx < W - 10; gx += 18 + Math.sin(gx * 0.13) * 8) {
    const h1 = 3 + Math.sin(gx * 0.07) * 2;
    const h2 = 4 + Math.sin(gx * 0.11 + 1) * 2;
    const h3 = 2.5 + Math.sin(gx * 0.09 + 2) * 1.5;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx - 1, y - h1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx + 3, y); ctx.lineTo(gx + 3, y - h2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx + 6, y); ctx.lineTo(gx + 7, y - h3); ctx.stroke();
  }

  // Trees — black silhouettes with varied shapes
  const col = '#1a1a1a';
  const trees = [
    // Far left cluster (3 trees close together)
    { x: 38,  type: 'lollipop-outline', h: 26, r: 8 },
    { x: 55,  type: 'round', h: 22, r: 10 },
    { x: 68,  type: 'triangle', h: 28, w: 16 },
    // Left-center cluster (4 trees)
    { x: 155, type: 'round', h: 32, r: 14 },
    { x: 175, type: 'lollipop', h: 24, r: 7 },
    { x: 190, type: 'triangle', h: 22, w: 12 },
    { x: 210, type: 'lollipop-outline', h: 20, r: 7 },
    // Center sparse (single tree)
    { x: W * 0.5, type: 'lollipop-outline', h: 18, r: 6 },
    // Right cluster (4 trees)
    { x: W - 240, type: 'round', h: 28, r: 12 },
    { x: W - 220, type: 'triangle', h: 24, w: 14 },
    { x: W - 200, type: 'lollipop-outline', h: 22, r: 8 },
    { x: W - 185, type: 'lollipop', h: 18, r: 6 },
    // Far right cluster (4 trees)
    { x: W - 120, type: 'triangle', h: 30, w: 16 },
    { x: W - 100, type: 'round', h: 24, r: 11 },
    { x: W - 80,  type: 'lollipop', h: 20, r: 7 },
    { x: W - 58,  type: 'lollipop-outline', h: 22, r: 8 },
  ];

  for (const t of trees) {
    const baseY = y;

    // Trunk
    ctx.fillStyle = col;
    ctx.fillRect(t.x - 1.2, baseY - t.h, 2.4, t.h + 1);

    const crownY = baseY - t.h;
    const r = t.r || 8;

    if (t.type === 'round') {
      // Filled black circle crown
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(t.x, crownY, r, 0, 6.28); ctx.fill();
      // Add sub-circles for organic feel
      ctx.beginPath(); ctx.arc(t.x - r * 0.4, crownY + r * 0.2, r * 0.6, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(t.x + r * 0.45, crownY + r * 0.15, r * 0.55, 0, 6.28); ctx.fill();
    } else if (t.type === 'triangle') {
      // Filled black triangle
      const w = t.w || 12;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(t.x, crownY - r);
      ctx.lineTo(t.x - w / 2, crownY + r * 0.6);
      ctx.lineTo(t.x + w / 2, crownY + r * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (t.type === 'lollipop') {
      // Filled black circle (simple lollipop)
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(t.x, crownY, r, 0, 6.28); ctx.fill();
    } else if (t.type === 'lollipop-outline') {
      // White circle with black outline (distinctive look from reference)
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(t.x, crownY, r, 0, 6.28); ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(t.x, crownY, r, 0, 6.28); ctx.stroke();
    }
  }

  ctx.restore();
};

// ═══════════════════════════════════════════════════════════════════
//  GLASS — very subtle, almost none
// ═══════════════════════════════════════════════════════════════════

AF.renderer.glass = function(ctx) {
  // Minimal — just a tiny hint of reflection
  const { W, H } = AF;
  ctx.save();
  ctx.globalAlpha = 0.012;
  ctx.translate(W * 0.2, 0);
  ctx.rotate(0.2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-10, 0, 20, H * 1.5);
  ctx.restore();
};

// ═══════════════════════════════════════════════════════════════════
//  FOOD
// ═══════════════════════════════════════════════════════════════════

AF.renderer.food = function(ctx, foods) {
  for (const f of foods) {
    const amt = f.amount || 3;
    const baseR = 3 + amt * 0.6;

    const seed = (f.x * 137 + f.y * 269) | 0;
    const crumbCount = Math.min(amt + 2, 8);
    for (let i = 0; i < crumbCount; i++) {
      const h = ((seed + i * 7919) * 2654435761) >>> 0;
      const cx = f.x + ((h & 0xFF) / 255 - 0.5) * baseR * 2;
      const cy = f.y + (((h >> 8) & 0xFF) / 255 - 0.5) * baseR * 1.5;
      const cr = 1 + ((h >> 16) & 0x3) * 0.5;
      // Simple dark crumbs
      ctx.fillStyle = 'rgba(80,70,55,0.7)';
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.28); ctx.fill();
    }
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
  const x = ant.x, y = ant.y + (ant.bodyBob || 0), s = ant.size;
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

  // ANTENNA
  ctx.strokeStyle = col; ctx.lineWidth = s * 0.12;
  const antBob = Math.sin(ant.antT) * 0.12;
  ctx.beginPath();
  ctx.moveTo(hdX + s * 0.15, hdY - s * 0.2);
  ctx.quadraticCurveTo(hdX + s * 0.35, hdY - s * 0.65 + antBob * s, hdX + s * 0.65, hdY - s * 0.75 + antBob * s);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(hdX + s * 0.65, hdY - s * 0.75 + antBob * s, s * 0.06, 0, 6.28); ctx.fill();

  // Food
  if (ant.carrying) {
    ctx.fillStyle = '#5a8a30';
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
