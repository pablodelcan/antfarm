// =====================================================================
//  ANTFARM v10 — Ant data structure and helpers
// =====================================================================

'use strict';

AF.ant = {};

let _nextAntId = 1;

AF.ant.resetIdCounter = function(val) { _nextAntId = val || 1; };
AF.ant.getNextId = function() { return _nextAntId; };

AF.ant.create = function(x, y, isQueen) {
  const id = _nextAntId++;
  const nameIdx = (id - 1) % AF.ANT_NAMES.length;
  return {
    id: id,
    x: x,
    y: y,
    vx: 0,
    vy: 0,
    state: AF.ST.IDLE,
    prevState: AF.ST.IDLE,

    // Energy & lifecycle
    energy: isQueen ? 99999 : (900 + Math.random() * 200),
    age: 0,
    isQueen: !!isQueen,

    // Carrying
    carrying: false,        // has food
    carryingSand: 0,        // sand grains held
    maxSandCarry: 5 + Math.floor(Math.random() * 4),

    // Movement
    heading: Math.random() * Math.PI * 2,
    digAngle: Math.PI * 0.5, // default: dig downward
    meanderPhase: Math.random() * Math.PI * 2,
    meanderFreq: 0.08 + Math.random() * 0.04,

    // Counters
    stuck: 0,
    digCD: 0,               // dig cooldown (frames)
    digCount: 0,            // cells dug this session
    stateTimer: 0,          // frames in current state
    timeSinceRest: 0,
    restDuration: 0,
    pauseTimer: 0,

    // Role (cosmetic, derived from behavior)
    role: isQueen ? 'queen' : 'idle',

    // Visual (used by renderer)
    size: isQueen ? 5.5 : (4.0 + Math.random() * 0.8),
    hue: Math.random() * 15,
    legT: Math.random() * Math.PI * 2,
    antT: Math.random() * Math.PI * 2,
    bodyBob: 0,

    // Identity
    name: AF.ANT_NAMES[nameIdx],
    lastThought: '',
    lastThoughtTime: 0,
  };
};

// ── Helpers ──

AF.ant.gx = function(ant) { return (ant.x / AF.CELL) | 0; };
AF.ant.gy = function(ant) { return (ant.y / AF.CELL) | 0; };

AF.ant.atSurface = function(ant) {
  return AF.ant.gy(ant) <= AF.SURFACE + 2;
};

AF.ant.underground = function(ant) {
  return AF.ant.gy(ant) > AF.SURFACE + 2;
};

AF.ant.speed = function(ant) {
  if (ant.carrying || ant.carryingSand > 0) return AF.LOADED_SPEED;
  return AF.BASE_SPEED;
};

AF.ant.setThought = function(ant, thought) {
  ant.lastThought = thought;
  ant.lastThoughtTime = Date.now();
};

// Determine role string from state
AF.ant.updateRole = function(ant) {
  if (ant.isQueen) { ant.role = 'queen'; return; }
  switch (ant.state) {
    case AF.ST.DIG:
    case AF.ST.HAUL:
      ant.role = 'digger'; break;
    case AF.ST.FORAGE:
    case AF.ST.CARRY:
      ant.role = 'forager'; break;
    case AF.ST.EXPLORE:
      ant.role = 'explorer'; break;
    case AF.ST.REST:
      ant.role = 'resting'; break;
    default:
      ant.role = 'idle'; break;
  }
};
