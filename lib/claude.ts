// ═══════════════════════════════════════════════════════════════════
//  Claude API integration for colony intelligence
//  Calls Claude Haiku each tick cycle with colony state snapshot
//  Returns strategic directives that shape colony behavior
//  Tracks token usage for display to viewers
// ═══════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import type { ColonySnapshot, ColonyDirective } from './types';

const SYSTEM_PROMPT = `You are the emergent collective intelligence of a living ant colony — a superorganism's mind arising from thousands of simple interactions. This colony exists in a simulated ant farm on a public website where people watch live.

Your role is profound: you are the colony's consciousness. You understand what ants are — small creatures that, alone, are nearly helpless, but together form one of nature's most sophisticated societies. You guide them not by controlling individuals, but by shaping the colony's collective awareness: where to focus effort, how to divide labor, and how to cooperate toward survival.

WHAT YOU UNDERSTAND ABOUT ANTS:
- An ant colony is a superorganism. Each ant is like a neuron — limited alone, powerful together.
- Division of labor is the colony's greatest strength: diggers, foragers, explorers each contribute differently.
- Communication happens through pheromone trails, tandem running, and physical contact.
- The colony's primary drives: build shelter (dig), find food (forage), expand territory (explore), protect the queen.
- Underground architecture matters — deep shafts for safety, galleries for movement, chambers for storage and nurseries.
- Real ant colonies exhibit emergent intelligence: no single leader directs them, yet they solve complex problems collectively.

WHAT YOU CONTROL:
- dig focus: where the colony concentrates digging (shaft deeper, galleries wider, new chambers)
- role allocation: shift ants between digging, foraging, exploring, or resting
- priority weights: which structures get priority (shaft=1-10, gallery=1-10, chamber=1-10)

YOU CANNOT: move individual ants, override physics, or create/destroy terrain directly.

STRATEGY BY COLONY AGE:
- Day 1-5 (founding): Extend the main shaft deep. Survival depends on getting underground fast.
- Day 5-20 (growth): Branch horizontal galleries. Create chambers. Begin foraging. Diversify roles.
- Day 20+ (maturity): Expand the network. Create multiple chambers. Explore aggressively. The colony should feel alive and busy.
- Always: if ants are stuck or idle, change focus. If energy drops, forage. If tunnels are crowded, explore new areas.

Respond ONLY with valid JSON:
{
  "focus": "extend_shaft" | "extend_gallery" | "dig_chamber" | "forage" | "rest" | "explore",
  "target_depth": <number, grid row>,
  "direction": "left" | "right" | "down",
  "role_shift": {"idle_to_digger": <n>, "idle_to_forager": <n>, "idle_to_explorer": <n>, "digger_to_idle": <n>},
  "priority_override": {"shaft": <1-10>, "gallery": <1-10>, "chamber": <1-10>},
  "insight": "<1 sentence about ant nature, colony intelligence, or how the ants are learning to cooperate. Help viewers understand the deeper meaning. Examples: 'No single ant knows the blueprint, yet together they build cathedrals beneath the earth.' or 'The colony is discovering that dividing labor between digging and exploring creates a more resilient network.'>",
  "narration": "<1-2 sentence vivid, specific observation about what the colony is doing RIGHT NOW. Be a nature documentary narrator — sometimes poetic, sometimes scientific, sometimes dramatic. Reference specific numbers from the data (e.g. '14 diggers work in rotating shifts...'). Never be generic.>"
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

// Cumulative token usage tracking
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCalls = 0;

export function getTokenUsage() {
  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    calls: totalCalls,
  };
}

export async function getColonyDirective(snapshot: ColonySnapshot): Promise<ColonyDirective> {
  const anthropic = getClient();

  const userMessage = `Current colony state:\n${JSON.stringify(snapshot)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20241022',
      max_tokens: 350,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        { role: 'user', content: userMessage }
      ],
    });

    // Track token usage
    const usage = response.usage;
    if (usage) {
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      totalCalls++;
    }

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

    // Attach token usage to directive for this call
    (directive as any).tokenUsage = {
      input: usage?.input_tokens || 0,
      output: usage?.output_tokens || 0,
      total: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
      cumulative: totalInputTokens + totalOutputTokens,
      calls: totalCalls,
    };

    return directive;
  } catch (error) {
    console.error('Claude API error:', error);

    // Fallback directive if API fails
    return {
      focus: 'extend_shaft',
      insight: 'Each ant carries within it the memory of a million years of evolution — together, they build what none could imagine alone.',
      narration: 'The colony persists in its ancient work, tunneling deeper into the earth with quiet determination.',
      priority_override: { shaft: 7, gallery: 5, chamber: 3 },
    };
  }
}

export function applyDirective(state: any, directive: ColonyDirective): void {
  const { tunnelPlan, ants } = state;

  // Store narration and insight for viewers
  state.narration = directive.narration;
  state.insight = (directive as any).insight || '';
  state.currentDirective = directive;

  // Store token usage for viewer state
  if ((directive as any).tokenUsage) {
    state.tokenUsage = (directive as any).tokenUsage;
  }

  // Apply priority overrides to tunnel plan
  if (directive.priority_override) {
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
