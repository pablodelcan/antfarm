// =====================================================================
//  ANTFARM v10 — Constants & Shared Namespace
// =====================================================================

'use strict';

window.AF = {};

// Canvas & grid dimensions
AF.W = 960;
AF.H = 680;
AF.CELL = 3;
AF.COLS = AF.W / AF.CELL;          // 320
AF.ROWS = Math.ceil(AF.H / AF.CELL); // 227
AF.SURFACE = Math.round(AF.ROWS * 0.27); // 61
AF.SURFACE_PX = AF.SURFACE * AF.CELL;    // 183
AF.FRAME = 3;

// Visual — light gray sand
AF.SAND_R = 210;
AF.SAND_G = 207;
AF.SAND_B = 203;

// Tunnel color — dark gray
AF.TUNNEL_R = 90;
AF.TUNNEL_G = 85;
AF.TUNNEL_B = 80;

// Movement speeds (pixels per frame)
AF.BASE_SPEED = 0.8;
AF.LOADED_SPEED = 0.45;

// Simplified 8-state machine
AF.ST = {
  IDLE:    0,
  ENTER:   1,
  DIG:     2,
  HAUL:    3,
  FORAGE:  4,
  CARRY:   5,
  EXPLORE: 6,
  REST:    7
};

AF.ST_NAMES = [
  'Idle', 'Entering', 'Digging', 'Hauling sand',
  'Foraging', 'Carrying food', 'Exploring', 'Resting'
];

// Ant names (fun colony member names)
AF.ANT_NAMES = [
  'Ada', 'Bea', 'Chip', 'Dot', 'Eve', 'Fig', 'Grit', 'Hex',
  'Ivy', 'Jade', 'Kit', 'Lux', 'Mote', 'Nix', 'Oak', 'Pip',
  'Quinn', 'Rex', 'Sol', 'Twig', 'Uma', 'Volt', 'Wren', 'Xena',
  'Yew', 'Zest', 'Ash', 'Beck', 'Cog', 'Dew', 'Elm', 'Fern',
  'Glen', 'Haze', 'Iris', 'Jet', 'Kale', 'Leaf', 'Moss', 'Noon',
  'Ore', 'Pine', 'Quill', 'Root', 'Sage', 'Tarn', 'Urn', 'Vale',
  'Wax', 'Yarrow', 'Zen', 'Amber', 'Bolt', 'Clay', 'Dusk', 'Ember',
  'Flint', 'Grain', 'Heath', 'Inca'
];

// Clamp utility
AF.clamp = function(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
