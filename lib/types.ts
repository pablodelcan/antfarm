// ═══════════════════════════════════════════════════════════════════
//  Shared types for Antfarm server/client communication
// ═══════════════════════════════════════════════════════════════════

export interface ColonySnapshot {
  day: number;
  pop: number;
  dug: string;       // e.g. "12.3%"
  roles: {
    digger: number;
    forager: number;
    explorer: number;
    idle: number;
  };
  shaft: {
    depth: number;
    x: number;
  };
  shaft2?: {
    depth: number;
    x: number;
  };
  galleries: Array<{
    depth: number;
    width: number;
  }>;
  chambers: number;
  food: number;
  energy_avg: number;
  stuck_ants: number;
  recent: string;     // brief description of recent events
}

export interface ColonyDirective {
  focus: 'extend_shaft' | 'extend_gallery' | 'dig_chamber' | 'forage' | 'rest' | 'explore';
  target_depth?: number;
  direction?: 'left' | 'right' | 'down';
  role_shift?: {
    idle_to_digger?: number;
    idle_to_forager?: number;
    idle_to_explorer?: number;
    digger_to_idle?: number;
  };
  priority_override?: {
    shaft?: number;
    gallery?: number;
    chamber?: number;
  };
  insight?: string;
  narration: string;
}

export interface AntViewState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: number;
  role: string;
  isQueen: boolean;
  carrying: boolean;
  carryingSand: number;
  size: number;
  hue: number;
  legT: number;
  antT: number;
  bodyBob: number;
  isPaused: boolean;
  antennateTimer: number;
  name: string;
  energy: number;
  age: number;
  lastThought: string;
}

export interface FoodViewState {
  x: number;
  y: number;
  amount: number;
}

export interface ViewerState {
  grid: string;           // base64 encoded Uint8Array
  ants: AntViewState[];
  foods: FoodViewState[];
  chambers: Array<{ x: number; y: number; size: number }>;
  tunnelPlan: {
    mainShaftX: number;
    mainShaftX2: number;
    shaftBottom: number;
    shaftBottom2: number;
    galleries: Array<{ depth: number; leftExtent: number; rightExtent: number }>;
    entrances: Array<{ gx: number }>;
  };
  frame: number;
  totalDug: number;
  simDay: number;
  narration: string;
  insight: string;
  directive: ColonyDirective | null;
  roleCounts: { digger: number; forager: number; explorer: number; idle: number };
  tokenUsage: { input: number; output: number; total: number; cumulative: number; calls: number } | null;
  timestamp: number;
  cols: number;
  rows: number;
  surface: number;
  cellSize: number;
}
