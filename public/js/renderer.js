// =====================================================================
//  ANTFARM v10 — Renderer: terrain, ants, particles, chrome
//  Ported from v9 viewer — adapted for 8-state machine
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
//  TERRAIN — pixel-level rendering with noise, depth, strata, edges
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

    // Sky
    for (let y = 0; y < SURFACE_PX; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        d[i] = 238; d[i + 1] = 235; d[i + 2] = 228; d[i + 3] = 255;
      }
    }

    // Ground
    for (let py = SURFACE_PX; py < H; py++) {
      const gy = (py / CELL) | 0;
      const depthFactor = (py - SURFACE_PX) / depthRange;
      const strataShift = Math.sin(py * 0.08) * 4 + Math.sin(py * 0.03) * 6;

      for (let px = 0; px < W; px++) {
        const gx = (px / CELL) | 0;
        const i = (py * W + px) * 4;
        const v = cellAt(gx, gy);

        if (v > 0) {
          // Bilinear edge detection
          const nearTunnel = (!cellAt(gx + 1, gy) || !cellAt(gx, gy + 1) || !cellAt(gx + 1, gy + 1) ||
            !cellAt(gx - 1, gy) || !cellAt(gx, gy - 1) ||
            !cellAt(gx - 1, gy - 1) || !cellAt(gx + 1, gy - 1) || !cellAt(gx - 1, gy + 1));

          // Base sand color with depth darkening
          const darkening = 1 - depthFactor * 0.3;
          let r = (SAND_R + strataShift) * darkening;
          let g = (SAND_G + strataShift * 0.6) * darkening;
          let b = (SAND_B + strataShift * 0.3) * darkening;

          // Pixel noise for texture
          const noise = (pixelHash(px, py) - 0.5) * 16;
          r += noise; g += noise * 0.8; b += noise * 0.6;

          // Edge shadow
          if (nearTunnel) {
            let shadow = 0, samples = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                samples++;
                if (!cellAt(gx + dx, gy + dy)) {
                  shadow += (dx === 0 || dy === 0) ? 1.0 : 0.7;
                }
              }
            }
            const edgeDarken = (shadow / (samples * 0.8)) * 0.35;
            r *= (1 - edgeDarken); g *= (1 - edgeDarken); b *= (1 - edgeDarken);
          }

          // Hardness tint
          if (v >= 3) { r += (v - 2) * 3; g -= (v - 2) * 1; }

          d[i]     = Math.max(0, Math.min(255, r)) | 0;
          d[i + 1] = Math.max(0, Math.min(255, g)) | 0;
          d[i + 2] = Math.max(0, Math.min(255, b)) | 0;
          d[i + 3] = 255;
        } else {
          // Tunnel — dark underground
          const td = depthFactor * 0.15;
          d[i] = (10 + td * 8) | 0;
          d[i + 1] = (8 + td * 6) | 0;
          d[i + 2] = (6 + td * 4) | 0;
          d[i + 3] = 255;
        }
      }
    }

    _tCtx.putImageData(tImg, 0, 0);
    _terrainImageData = _tCtx.getImageData(0, 0, W, H);
    state.terrainDirty = false;
  }

  ctx.filter = 'blur(0.5px)';
  ctx.drawImage(_tOff, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 0.4;
  ctx.drawImage(_tOff, 0, 0);
  ctx.globalAlpha = 1.0;
};

// ═══════════════════════════════════════════════════════════════════
//  FRAME — green border with bolts
// ═══════════════════════════════════════════════════════════════════

AF.renderer.frame = function(ctx) {
  const { W, H, FRAME } = AF;
  const green = '#2d8c3c', greenDark = '#1e6b2b', greenLight = '#3aad4d';

  ctx.fillStyle = green;
  ctx.fillRect(0, 0, W, FRAME);
  ctx.fillRect(0, H - FRAME * 2.5, W, FRAME * 2.5);
  ctx.fillRect(0, 0, FRAME, H);
  ctx.fillRect(W - FRAME, 0, FRAME, H);

  const boltR = 5;
  const bolts = [
    [FRAME / 2, FRAME / 2], [W - FRAME / 2, FRAME / 2],
    [FRAME / 2, H - FRAME * 1.5], [W - FRAME / 2, H - FRAME * 1.5],
    [FRAME / 2, H * 0.35], [W - FRAME / 2, H * 0.35],
    [FRAME / 2, H * 0.65], [W - FRAME / 2, H * 0.65]
  ];
  for (const [bx, by] of bolts) {
    ctx.beginPath(); ctx.arc(bx, by, boltR, 0, 6.28); ctx.fillStyle = greenDark; ctx.fill();
    ctx.beginPath(); ctx.arc(bx - 1, by - 1, boltR * 0.6, 0, 6.28); ctx.fillStyle = greenLight; ctx.fill();
  }

  for (let i = 0; i < 7; i++) {
    ctx.beginPath(); ctx.arc(W * 0.35 + i * 12, FRAME * 0.5, 2, 0, 6.28);
    ctx.fillStyle = greenDark; ctx.fill();
  }

  ctx.strokeStyle = greenLight; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(FRAME, 1); ctx.lineTo(W - FRAME, 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1, FRAME); ctx.lineTo(1, H - FRAME * 2.5); ctx.stroke();
  ctx.strokeStyle = greenDark;
  ctx.beginPath(); ctx.moveTo(FRAME, FRAME - 1); ctx.lineTo(W - FRAME, FRAME - 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 2, FRAME); ctx.lineTo(W - 2, H - FRAME * 2.5); ctx.stroke();
};

// ═══════════════════════════════════════════════════════════════════
//  SILHOUETTE — trees, grass, ground line
// ═══════════════════════════════════════════════════════════════════

AF.renderer.silhouette = function(ctx) {
  const { SURFACE_PX, FRAME, W } = AF;
  const y = SURFACE_PX, left = FRAME, right = W - FRAME;

  ctx.save(); ctx.fillStyle = '#2a8a38';

  ctx.fillRect(left, y - 1, right - left, 3);
  ctx.beginPath(); ctx.moveTo(left, y);
  for (let x = left; x <= right; x++) {
    const hill = Math.sin((x - left) * 0.006) * 5 + Math.sin((x - left) * 0.018) * 2;
    ctx.lineTo(x, y - hill - 2);
  }
  ctx.lineTo(right, y); ctx.closePath(); ctx.fill();

  for (const tx of [left + 60, left + 280, right - 230, right - 80]) {
    ctx.fillRect(tx, y - 16, 2.5, 14);
    ctx.beginPath(); ctx.arc(tx + 1.2, y - 19, 7, 0, 6.28); ctx.fill();
  }

  ctx.fillStyle = '#1e6b2b';
  for (let gx = left + 20; gx < right - 20; gx += 35 + Math.sin(gx * 0.1) * 15) {
    ctx.fillRect(gx, y - 4, 1.5, 4);
    ctx.fillRect(gx + 3, y - 5, 1.5, 5);
    ctx.fillRect(gx + 6, y - 3, 1.5, 3);
  }

  ctx.restore();
};

// ═══════════════════════════════════════════════════════════════════
//  GLASS — reflection overlay
// ═══════════════════════════════════════════════════════════════════

AF.renderer.glass = function(ctx) {
  const { W, H, FRAME } = AF;
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H * 0.4);
  g.addColorStop(0, 'rgba(255,255,255,0.04)');
  g.addColorStop(0.4, 'rgba(255,255,255,0)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(FRAME, FRAME, W - FRAME * 2, H - FRAME * 3.5);
  ctx.save(); ctx.globalAlpha = 0.025; ctx.translate(W * 0.25, 0); ctx.rotate(0.25);
  ctx.fillStyle = '#fff'; ctx.fillRect(-15, 0, 30, H * 1.5); ctx.restore();
};

// ═══════════════════════════════════════════════════════════════════
//  FOOD
// ═══════════════════════════════════════════════════════════════════

AF.renderer.food = function(ctx, foods) {
  const { SAND_R, SAND_G, SAND_B } = AF;
  for (const f of foods) {
    const amt = f.amount || 3;
    const baseR = 3 + amt * 0.6;

    ctx.beginPath(); ctx.arc(f.x, f.y, baseR * 2.5, 0, 6.28);
    ctx.fillStyle = 'rgba(180,140,60,0.04)'; ctx.fill();

    const seed = (f.x * 137 + f.y * 269) | 0;
    const crumbCount = Math.min(amt + 2, 8);
    for (let i = 0; i < crumbCount; i++) {
      const h = ((seed + i * 7919) * 2654435761) >>> 0;
      const cx = f.x + ((h & 0xFF) / 255 - 0.5) * baseR * 2;
      const cy = f.y + (((h >> 8) & 0xFF) / 255 - 0.5) * baseR * 1.5;
      const cr = 1 + ((h >> 16) & 0x3) * 0.5;
      const kind = (h >> 20) & 0x3;
      if (kind === 0) {
        ctx.fillStyle = 'rgba(245,240,230,0.9)';
        ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 1.8);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(cx - cr + 0.5, cy - cr + 0.5, cr, cr * 0.6);
      } else if (kind === 1) {
        ctx.fillStyle = 'rgba(180,140,80,0.85)';
        ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.28); ctx.fill();
      } else if (kind === 2) {
        ctx.fillStyle = 'rgba(200,80,40,0.85)';
        ctx.beginPath(); ctx.arc(cx, cy, cr * 1.1, 0, 6.28); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(90,60,30,0.8)';
        ctx.beginPath(); ctx.ellipse(cx, cy, cr * 1.2, cr * 0.6, (h & 0xF) * 0.4, 0, 6.28); ctx.fill();
      }
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
  // Default (IDLE, ENTER, FORAGE)
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

  // Sand grain
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
    ctx.fillStyle = '#78b840';
    ctx.beginPath(); ctx.arc(hdX + s * 0.45, hdY - s * 0.05, s * 0.25, 0, 6.28); ctx.fill();
  }

  // Queen marker
  if (ant.isQueen) {
    ctx.fillStyle = 'rgba(255,200,50,0.6)';
    ctx.beginPath(); ctx.arc(thX, thY - s * 0.5, s * 0.15, 0, 6.28); ctx.fill();
  }

  // Hover highlight
  if (hoveredAnt === ant) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 2.2, s * 1.5, 0, 0, 6.28); ctx.stroke();
  }

  // Dig dust
  if (posture.dustChance > 0 && Math.random() < posture.dustChance && mov && particles) {
    particles.push({
      x: ant.x + (facingRight * s * 1.5), y: ant.y + s * 0.3,
      vx: (Math.random() - 0.5) * 1.5 * facingRight, vy: Math.random() * -1.2 - 0.3,
      life: 15 + Math.random() * 10, size: 0.8 + Math.random() * 0.8,
      r: SAND_R - 5, g: SAND_G - 5, b: SAND_B - 3
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
      ctx.fillStyle = f.color || '#b48c50';
      ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 6.28); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(-0.5, -0.5, 1, 0, 6.28); ctx.fill();
    }
    ctx.restore();
  }
};
