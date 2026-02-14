// ═══════════════════════════════════════════════════════════════════
//  Shared types for Antfarm v10 server/client communication
// ═══════════════════════════════════════════════════════════════════

// Compact colony snapshot sent to Claude AI for decision-making
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
  food: number;
  chambers: number;
  avgEnergy: number;
  stuck: number;
}

// Directive returned by Claude AI
export interface ColonyDirective {
  focus: 'extend_shaft' | 'extend_gallery' | 'dig_chamber' | 'forage' | 'rest' | 'explore';
  target_depth?: number;
  direction?: 'left' | 'right' | 'down';
  role_shift?: {
    idle_to_digger?: number;
    idle_to_forager?: number;
    idle_to_explorer?: number;
  };
  insight?: string;
  narration: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    cumulative: number;
    calls: number;
  };
}
