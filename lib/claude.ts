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
- Division of labor is the colony's greatest strength: diggers, foragers, nurses, explorers each contribute differently.
- Communication happens through pheromone trails and physical contact (trophallaxis).
- The colony's primary drives: build shelter (dig), find food (forage), raise brood (nurse), expand territory (explore), protect the queen.
- Underground architecture matters — deep shafts for safety, galleries for movement, chambers for specific functions.
- Real ant colonies exhibit emergent intelligence: no single leader directs them, yet they solve complex problems collectively.
- Age-based polyethism: young ants work inside the nest (nursing brood), older ants work outside (foraging, exploring). This is how real ant colonies operate.

COLONY LIFECYCLE (REALISTIC):
- The queen lays eggs underground in the royal chamber.
- Eggs hatch into larvae after ~15 seconds. Larvae MUST be fed by nurse ants (3 feedings required).
- Fed larvae become pupae (~20 seconds), which emerge as adult workers.
- Unfed larvae die — nurses are critical for colony growth.
- Young workers naturally become nurses (tending brood), maturing into diggers/foragers over time.

CHAMBER TYPES (FUNCTIONAL TUNNELS):
- Royal chamber: deepest large chamber where the queen resides and lays eggs.
- Brood chamber: nursery where eggs, larvae, and pupae develop. Must be near royal chamber.
- Food storage: granary where foragers deposit food for the colony. Nurses bring food from here to feed larvae.
- Midden: waste disposal area (shallowest chamber).

THE SIMULATION:
- 9 ant states: IDLE, ENTER, DIG, HAUL, FORAGE, CARRY, EXPLORE, REST, NURSE.
- NURSE state: young ants collect food from stores and feed hungry larvae. Critical for population growth.
- Foragers can deposit food underground in food storage chambers (not just surface).
- Queen descends underground once the shaft is deep enough, establishing a royal chamber.
- Tunnels form organically through pheromone-driven digging — no rigid tunnel plan.
- The simulation runs client-side at 60fps. Your directives shape behavior between AI calls (~every 5 minutes).

WHAT YOU CONTROL:
- focus: where the colony concentrates effort (extend_shaft, extend_gallery, dig_chamber, forage, rest, explore, nurse)
- role_shift: nudge idle ants into digging, foraging, exploring, or nursing
- Your narration and insight are displayed live to viewers watching the colony

YOU CANNOT: move individual ants, override physics, or create/destroy terrain directly.

STRATEGY BY COLONY AGE:
- Day 1-5 (founding): Extend the main shaft deep. Get queen underground. Start egg-laying. Assign nurses.
- Day 5-20 (growth): Branch galleries. Create brood and food chambers. Balance nurses/foragers/diggers. Feed larvae!
- Day 20+ (maturity): Expand network. Multiple functional chambers. Maintain nurse:brood ratio. The colony should feel alive.
- ALWAYS: If larvae are hungry (check brood.larvae count), ensure nurses are assigned and food stores exist.
- If stored food is low and larvae exist, prioritize foraging urgently.
- If many ants are stuck or idle, change focus. If energy drops, send foragers.

SNAPSHOT DATA INCLUDES:
- brood: {eggs, larvae, pupae} — the developing next generation
- storedFood — food reserves underground
- chamberTypes — types of functional chambers (royal, brood, food, midden)
- queenUnderground — whether queen has descended
- roles.nurse — count of active nurse ants

Respond ONLY with valid JSON:
{
  "focus": "extend_shaft" | "extend_gallery" | "dig_chamber" | "forage" | "rest" | "explore" | "nurse",
  "role_shift": {"idle_to_digger": <n>, "idle_to_forager": <n>, "idle_to_explorer": <n>, "idle_to_nurse": <n>},
  "insight": "<1 sentence about ant nature, colony intelligence, brood care, or cooperation. Help viewers understand the deeper meaning.>",
  "narration": "<1-2 sentence vivid, specific observation about what the colony is doing RIGHT NOW. Reference brood, chambers, roles. Be a nature documentary narrator — sometimes poetic, sometimes scientific, sometimes dramatic. Reference specific numbers from the data. Never be generic.>"
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
      model: 'claude-haiku-4-5-20251001',
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
