// Agent Definition Registry
// Each tactic category maps to an agent with specialized prompts and tools.

import type { AgentDefinition } from "../types";
import type { TacticCategory } from "@prisma/client";
import { socialMediaAgent } from "./social-media.agent";
import { communityAgent } from "./community.agent";
import { storePresenceAgent } from "./store-presence.agent";
import { contentMarketingAgent } from "./content-marketing.agent";
import { generalAgent } from "./general.agent";
import { loanProcessingAgent } from "./loan-processing.agent";

const agentRegistry = new Map<TacticCategory, AgentDefinition>();

// Register all agents
function register(def: AgentDefinition) {
  for (const category of def.categories) {
    agentRegistry.set(category, def);
  }
}

register(socialMediaAgent);
register(communityAgent);
register(storePresenceAgent);
register(contentMarketingAgent);
register(generalAgent);         // fallback for most unmatched categories
register(loanProcessingAgent); // handles OTHER (example/test workflow agent)

/**
 * Get the agent definition for a given tactic category.
 * Falls back to the general agent if no specific agent exists.
 */
export function getAgentDefinition(category: TacticCategory): AgentDefinition | undefined {
  return agentRegistry.get(category) || agentRegistry.get("OTHER");
}

export function getAllAgentDefinitions(): AgentDefinition[] {
  const seen = new Set<string>();
  const defs: AgentDefinition[] = [];
  for (const def of agentRegistry.values()) {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      defs.push(def);
    }
  }
  return defs;
}
