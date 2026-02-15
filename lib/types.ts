// ═══════════════════════════════════════════════════════════════════
//  Shared types for Antfarm v11 server/client communication
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
    nurse: number;
    idle: number;
  };
  food: number;
  storedFood?: number;   // underground food reserves
  brood?: {
    eggs: number;
    larvae: number;
    pupae: number;
  };
  chambers: number;
  chamberTypes?: Record<string, number>;
  queenUnderground?: boolean;
  avgEnergy: number;
  stuck: number;
}

// Directive returned by Claude AI
export interface ColonyDirective {
  focus: 'extend_shaft' | 'extend_gallery' | 'dig_chamber' | 'forage' | 'rest' | 'explore' | 'nurse';
  target_depth?: number;
  direction?: 'left' | 'right' | 'down';
  role_shift?: {
    idle_to_digger?: number;
    idle_to_forager?: number;
    idle_to_explorer?: number;
    idle_to_nurse?: number;
  };
  insight?: string;
  narration: string;
  tuning?: Record<string, number>;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    cumulative: number;
    calls: number;
  };
}
