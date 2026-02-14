// ═══════════════════════════════════════════════════════════════════
//  Claude API integration for colony intelligence — v10
//  Calls Claude Haiku with colony snapshot
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
- Communication happens through pheromone trails and physical contact.
- The colony's primary drives: build shelter (dig), find food (forage), expand territory (explore), protect the queen.
- Underground architecture matters — deep shafts for safety, galleries for movement, chambers for storage and nurseries.
- Real ant colonies exhibit emergent intelligence: no single leader directs them, yet they solve complex problems collectively.

THE SIMULATION:
- 8 ant states: IDLE (surface wandering), ENTER (descending to dig), DIG (digging in any direction), HAUL (carrying sand to surface), FORAGE (seeking food), CARRY (returning food), EXPLORE (underground scouting), REST (energy recovery).
- Tunnels form organically through pheromone-driven digging — no rigid tunnel plan.
- Ants follow dig pheromone gradients, creating coherent shafts and branches naturally.
- The simulation runs client-side at 60fps. Your directives shape behavior between AI calls (~every 5 minutes).

WHAT YOU CONTROL:
- focus: where the colony concentrates effort (extend_shaft, extend_gallery, dig_chamber, forage, rest, explore)
- role_shift: nudge idle ants into digging, foraging, or exploring
- Your narration and insight are displayed live to viewers watching the colony

YOU CANNOT: move individual ants, override physics, or create/destroy terrain directly.

STRATEGY BY COLONY AGE:
- Day 1-5 (founding): Extend the main shaft deep. Survival depends on getting underground fast. Most ants should dig.
- Day 5-20 (growth): Branch horizontal galleries. Create chambers. Begin foraging. Diversify roles.
- Day 20+ (maturity): Expand the network. Create multiple chambers. Explore aggressively. The colony should feel alive and busy.
- Always: if ants are stuck or idle, change focus. If energy drops, send foragers. If tunnels are crowded, explore new areas.

Respond ONLY with valid JSON:
{
  "focus": "extend_shaft" | "extend_gallery" | "dig_chamber" | "forage" | "rest" | "explore",
  "role_shift": {"idle_to_digger": <n>, "idle_to_forager": <n>, "idle_to_explorer": <n>},
  "insight": "<1 sentence about ant nature, colony intelligence, or cooperation. Help viewers understand the deeper meaning.>",
  "narration": "<1-2 sentence vivid, specific observation about what the colony is doing RIGHT NOW. Be a nature documentary narrator — sometimes poetic, sometimes scientific, sometimes dramatic. Reference specific numbers from the data. Never be generic.>"
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
    directive.tokenUsage = {
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
    };
  }
}
