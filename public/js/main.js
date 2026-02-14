// =====================================================================
//  ANTFARM v10 — Main: game loop, HUD, events, initialization
// =====================================================================

'use strict';

// ── State ──
let state = null;
let running = false;
let particles = [];
let terrainParticles = [];
let fallingObjects = [];
let hoveredAnt = null;
let mouseX = 0, mouseY = 0;
let canvas, ctx;

// ── HUD elements (cached) ──
let elSAnts, elSTunnel, elSChambers, elSDay;
let elStatusText, elTooltip;
let elTtName, elTtState, elTtEnergy, elTtRole, elTtThought;
let elIntelFocus, elIntelRoles, elIntelTokens, elIntelInsight;
let elAiNarration;

// ═══════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

async function begin() {
  // Hide intro, show app
  document.querySelector('.intro').classList.add('hide');
  setTimeout(() => { document.querySelector('.intro').style.display = 'none'; }, 800);
  document.getElementById('app').style.display = 'flex';

  // Canvas setup
  canvas = document.getElementById('c');
  ctx = canvas.getContext('2d');
  canvas.width = AF.W;
  canvas.height = AF.H;
  AF.renderer.init(canvas);

  // Cache DOM elements
  elSAnts = document.getElementById('sAnts');
  elSTunnel = document.getElementById('sTunnel');
  elSChambers = document.getElementById('sChambers');
  elSDay = document.getElementById('sDay');
  elStatusText = document.getElementById('statusText');
  elTooltip = document.getElementById('tooltip');
  elTtName = document.getElementById('ttName');
  elTtState = document.getElementById('ttState');
  elTtEnergy = document.getElementById('ttEnergy');
  elTtRole = document.getElementById('ttRole');
  elTtThought = document.getElementById('ttThought');
  elIntelFocus = document.getElementById('intelFocus');
  elIntelRoles = document.getElementById('intelRoles');
  elIntelTokens = document.getElementById('intelTokens');
  elIntelInsight = document.getElementById('intelInsight');
  elAiNarration = document.getElementById('aiNarration');

  // Try to load checkpoint from server
  elStatusText.textContent = 'Loading colony...';
  const saved = await AF.network.fetchCheckpoint();

  if (saved && saved.checkpoint) {
    state = AF.colony.deserialize(saved.checkpoint);
    if (saved.directive) AF.colony.applyDirective(state, saved.directive);
    elStatusText.textContent = 'Colony restored — Day ' + state.simDay;
  } else {
    state = AF.colony.create();
    elStatusText.textContent = 'New colony started';
  }

  resizeCanvas();
  running = true;
  requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════════════════════════
//  GAME LOOP — runs at 60fps
// ═══════════════════════════════════════════════════════════════════

function gameLoop() {
  if (!running || !state) return;

  // Simulation tick
  AF.colony.tick(state);

  // Particle physics
  tickParticles();

  // Render
  ctx.clearRect(0, 0, AF.W, AF.H);
  AF.renderer.terrain(ctx, state);
  AF.renderer.silhouette(ctx);
  AF.renderer.food(ctx, state.foods);
  AF.renderer.particles(ctx, particles, terrainParticles);
  for (const ant of state.ants) {
    AF.renderer.ant(ctx, ant, hoveredAnt, particles);
  }
  AF.renderer.fallingObjects(ctx, fallingObjects);
  AF.renderer.frame(ctx);
  AF.renderer.glass(ctx);

  // HUD
  updateHUD();

  // Network (non-blocking)
  AF.network.saveCheckpoint(state).catch(() => {});
  AF.network.pollDirective(state).catch(() => {});

  requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════════════════

function tickParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.97;
    if (--p.life <= 0) particles.splice(i, 1);
  }
  for (let i = terrainParticles.length - 1; i >= 0; i--) {
    const p = terrainParticles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.96;
    if (--p.life <= 0) terrainParticles.splice(i, 1);
  }
  for (let i = fallingObjects.length - 1; i >= 0; i--) {
    const f = fallingObjects[i];
    f.vy += 0.25;
    f.y += f.vy; f.x += f.vx; f.vx *= 0.99; f.rotation += f.rotSpeed;
    if (f.y > AF.SURFACE_PX - 5) {
      f.y = AF.SURFACE_PX - 5; f.vy *= -0.3;
      if (Math.abs(f.vy) < 0.5) fallingObjects.splice(i, 1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════════════════

function updateHUD() {
  if (!state) return;
  const pct = (state.totalDug / ((AF.ROWS - AF.SURFACE) * AF.COLS) * 100).toFixed(1);
  elSAnts.textContent = state.ants.length;
  elSTunnel.textContent = pct + '%';
  elSChambers.textContent = state.chambers.length;
  elSDay.textContent = state.simDay;
  elStatusText.textContent = 'Day ' + state.simDay;

  // Intelligence panel
  updateIntelBar();
}

function updateIntelBar() {
  const FOCUS_LABELS = {
    extend_shaft: 'Extending main shaft',
    extend_gallery: 'Widening galleries',
    dig_chamber: 'Carving new chamber',
    forage: 'Foraging for food',
    rest: 'Colony resting',
    explore: 'Exploring new paths'
  };

  if (state.directive) {
    elIntelFocus.textContent = FOCUS_LABELS[state.directive.focus] || state.directive.focus || 'Observing colony';
  }

  const roles = AF.colony.getRoleCounts(state);
  elIntelRoles.innerHTML =
    '<span style="color:#d4a462">D:' + roles.digger + '</span> digging · ' +
    '<span style="color:#7bb84a">F:' + roles.forager + '</span> foraging · ' +
    '<span style="color:#6baed6">E:' + roles.explorer + '</span> exploring · ' +
    '<span style="color:#999">I:' + roles.idle + '</span> idle';

  if (state.tokenUsage && state.tokenUsage.total > 0) {
    const cum = state.tokenUsage.cumulative || state.tokenUsage.total;
    elIntelTokens.innerHTML =
      '<span class="tok-num">' + formatTokens(cum) + '</span> tokens · ' +
      '<span class="tok-num">' + (state.tokenUsage.calls || 1) + '</span> thoughts';
  }

  if (state.insight) {
    elIntelInsight.textContent = state.insight;
  }

  if (state.narration && elAiNarration) {
    elAiNarration.textContent = state.narration;
  }
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n;
}

// ═══════════════════════════════════════════════════════════════════
//  TOOLTIP
// ═══════════════════════════════════════════════════════════════════

function updateTooltip() {
  if (!running || !state) return;
  const rect = canvas.getBoundingClientRect();
  const sx = AF.W / rect.width, sy = AF.H / rect.height;
  const cx = (mouseX - rect.left) * sx, cy = (mouseY - rect.top) * sy;

  hoveredAnt = null;
  let closest = 15;
  for (const ant of state.ants) {
    const d = Math.hypot(ant.x - cx, ant.y - cy);
    if (d < closest) { closest = d; hoveredAnt = ant; }
  }

  if (hoveredAnt) {
    const a = hoveredAnt;
    elTtName.textContent = a.name;
    elTtState.textContent = AF.ST_NAMES[a.state] || 'Unknown';
    elTtEnergy.textContent = Math.round(a.energy);
    elTtRole.textContent = a.role + (a.isQueen ? ' (queen)' : '') + (a.carryingSand > 0 ? ' [hauling]' : '');
    elTtThought.textContent = a.lastThought || '\u2014';
    elTooltip.classList.add('show');
    elTooltip.style.left = (mouseX + 16) + 'px';
    elTooltip.style.top = (mouseY - 12) + 'px';
  } else {
    elTooltip.classList.remove('show');
  }
}

document.addEventListener('mousemove', e => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  updateTooltip();
});

// ═══════════════════════════════════════════════════════════════════
//  ADMIN PANEL — j+k+l toggle
// ═══════════════════════════════════════════════════════════════════

const keysDown = new Set();
let adminVisible = false;

document.addEventListener('keydown', e => {
  keysDown.add(e.key.toLowerCase());
  if (keysDown.has('j') && keysDown.has('k') && keysDown.has('l')) {
    adminVisible = !adminVisible;
    document.getElementById('adminPanel').classList.toggle('show', adminVisible);
    keysDown.clear();
  }
});
document.addEventListener('keyup', e => keysDown.delete(e.key.toLowerCase()));

// Admin actions (applied directly to client-side state)
function adminAction(action, value) {
  if (!state) return;

  if (action === 'addAnts') {
    AF.colony.dropAnts(state, 5);
    for (let i = 0; i < 5; i++) {
      fallingObjects.push({
        type: 'ant',
        x: AF.W * 0.3 + Math.random() * AF.W * 0.4,
        y: AF.FRAME + 5,
        vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2,
        rotation: (Math.random() - 0.5) * 1.5, rotSpeed: (Math.random() - 0.5) * 0.15,
      });
    }
    toast('Added 5 ants');
  } else if (action === 'dropFood') {
    AF.colony.dropFood(state);
    const colors = ['#b48c50', '#e8d8b0', '#c85028', '#5a3c1e'];
    for (let i = 0; i < 6; i++) {
      fallingObjects.push({
        type: 'food',
        x: AF.W * 0.35 + Math.random() * AF.W * 0.3,
        y: AF.FRAME + 5,
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 1.5,
        rotation: 0, rotSpeed: (Math.random() - 0.5) * 0.2,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
    toast('Dropped food');
  } else if (action === 'setSpeed') {
    document.getElementById('speedVal').textContent = value + 'x';
    toast('Speed: ' + value + 'x');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  RESTART COLONY
// ═══════════════════════════════════════════════════════════════════

function restartColony() {
  if (!confirm('Restart the ant colony from scratch? All progress will be lost.')) return;
  state = AF.colony.create();
  particles = [];
  terrainParticles = [];
  fallingObjects = [];
  hoveredAnt = null;
  // Force save fresh state
  AF.network.lastSave = 0;
  AF.network.saveCheckpoint(state).catch(() => {});
  toast('Colony restarted!');
}

// ═══════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

// ═══════════════════════════════════════════════════════════════════
//  CANVAS RESIZE
// ═══════════════════════════════════════════════════════════════════

function resizeCanvas() {
  const wrap = document.getElementById('wrap');
  if (!wrap || !canvas) return;
  const aspect = AF.W / AF.H;
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  if (wW / wH > aspect) {
    canvas.style.height = wH + 'px';
    canvas.style.width = (wH * aspect) + 'px';
  } else {
    canvas.style.width = wW + 'px';
    canvas.style.height = (wW / aspect) + 'px';
  }
}

window.addEventListener('resize', resizeCanvas);
