// ═══════════════════════════════════════════════════════════════════
//  Claude API integration for colony intelligence
//  Calls Claude Haiku every 5 minutes with colony state snapshot
//  Returns strategic directives that shape colony behavior
// ═══════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import type { ColonySnapshot, ColonyDirective } from './types';

const SYSTEM_PROMPT = `You are the collective intelligence of an ant colony in a simulated ant farm visible to the public on a website. Thousands of people may be watching these ants right now. Every 5 minutes you assess the colony's state and issue one strategic directive.

You control:
- dig focus: where the colony concentrates digging effort (shaft deeper, galleries wider, new chambers)
- role allocation: shift idle ants to digging, foraging, or exploring
- priority weights: which tunnel structures get priority (shaft=1-10, gallery=1-10, chamber=1-10)

You cannot: move individual ants, override physics, create or destroy terrain directly.

Colony structure: 1-2 vertical main shafts → horizontal galleries branching off at depth intervals → round chambers at gallery ends. This mimics real harvester ant architecture.

Roles: digger (excavates tunnels), forager (collects food), explorer (discovers new paths), idle (waiting for assignment).

Strategy tips:
- Early colony (day 1-5): Focus on extending the main shaft deep. Need vertical depth before galleries.
- Mid colony (day 5-20): Branch galleries at different depths. Variety makes the farm visually interesting.
- Mature colony (day 20+): Focus on chambers, exploring, and expanding gallery width. Aesthetic matters.
- If many ants are stuck or idle, shift priorities or change focus.
- If energy is low across the colony, shift some ants to foraging/rest.

Respond ONLY with valid JSON matching this schema:
{
  "focus": "extend_shaft" | "extend_gallery" | "dig_chamber" | "forage" | "rest" | "explore",
  "target_depth": <number, grid row for gallery focus>,
  "direction": "left" | "right" | "down",
  "role_shift": {"idle_to_digger": <n>, "idle_to_forager": <n>, "idle_to_explorer": <n>, "digger_to_idle": <n>},
  "priority_override": {"shaft": <1-10>, "gallery": <1-10>, "chamber": <1-10>},
  "narration": "<1-2 sentence poetic/nature-documentary observation about the colony for website viewers. Be evocative and specific about what the ants are doing. Vary your tone — sometimes scientific, sometimes whimsical, sometimes dramatic.>"
}`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

export async function getColonyDirective(snapshot: ColonySnapshot): Promise<ColonyDirective> {
  const anthropic = getClient();

  const userMessage = `Current colony state:\n${JSON.stringify(snapshot)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20241022',
      max_tokens: 256,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }  // Enable prompt caching
        }
      ],
      messages: [
        { role: 'user', content: userMessage }
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const directive: ColonyDirective = JSON.parse(jsonStr);

    // Validate required fields
    if (!directive.focus || !directive.narration) {
      throw new Error('Missing required fields in directive');
    }

    return directive;
  } catch (error) {
    console.error('Claude API error:', error);

    // Fallback directive if API fails
    return {
      focus: 'extend_shaft',
      narration: 'The colony works steadily, each ant knowing its purpose in the grand design of underground architecture.',
      priority_override: { shaft: 7, gallery: 5, chamber: 3 },
    };
  }
}

export function applyDirective(state: any, directive: ColonyDirective): void {
  const { tunnelPlan, ants } = state;

  // Store narration for viewers
  state.narration = directive.narration;
  state.currentDirective = directive;

  // Apply priority overrides to tunnel plan
  if (directive.priority_override) {
    // Store on tunnel plan for frontier calculation
    tunnelPlan.priorityOverride = directive.priority_override;
  }

  // Apply role shifts
  if (directive.role_shift) {
    const shifts = directive.role_shift;

    if (shifts.idle_to_digger && shifts.idle_to_digger > 0) {
      let count = shifts.idle_to_digger;
      for (const ant of ants) {
        if (count <= 0) break;
        if (ant.role === 'idle' && !ant.isQueen) {
          ant.role = 'digger';
          ant.state = 1; // ST.ENTER
          count--;
        }
      }
    }

    if (shifts.idle_to_forager && shifts.idle_to_forager > 0) {
      let count = shifts.idle_to_forager;
      for (const ant of ants) {
        if (count <= 0) break;
        if (ant.role === 'idle' && !ant.isQueen) {
          ant.role = 'forager';
          ant.state = 7; // ST.FORAGE
          count--;
        }
      }
    }

    if (shifts.idle_to_explorer && shifts.idle_to_explorer > 0) {
      let count = shifts.idle_to_explorer;
      for (const ant of ants) {
        if (count <= 0) break;
        if (ant.role === 'idle' && !ant.isQueen) {
          ant.role = 'explorer';
          ant.state = 5; // ST.EXPLORE
          count--;
        }
      }
    }

    if (shifts.digger_to_idle && shifts.digger_to_idle > 0) {
      let count = shifts.digger_to_idle;
      for (const ant of ants) {
        if (count <= 0) break;
        if (ant.role === 'digger' && !ant.isQueen) {
          ant.role = 'idle';
          ant.state = 0; // ST.WANDER
          count--;
        }
      }
    }
  }

  // Apply focus-based tunnel plan adjustments
  if (directive.focus === 'extend_shaft') {
    // Increase shaft priority in frontier
    tunnelPlan.focusType = 'shaft';
    tunnelPlan.focusDepth = directive.target_depth || null;
  } else if (directive.focus === 'extend_gallery') {
    tunnelPlan.focusType = 'gallery';
    tunnelPlan.focusDepth = directive.target_depth || null;
    tunnelPlan.focusDirection = directive.direction || null;
  } else if (directive.focus === 'dig_chamber') {
    tunnelPlan.focusType = 'chamber';
    tunnelPlan.focusDepth = directive.target_depth || null;
  } else if (directive.focus === 'explore') {
    tunnelPlan.focusType = 'explore';
  } else if (directive.focus === 'rest') {
    tunnelPlan.focusType = 'rest';
  } else if (directive.focus === 'forage') {
    tunnelPlan.focusType = 'forage';
  }
}
