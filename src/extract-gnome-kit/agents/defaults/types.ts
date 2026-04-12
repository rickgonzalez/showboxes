import type { TacticCategory } from "@prisma/client";
import type { ToolProviderType } from "../types";

/**
 * Pure data representation of a built-in gnome.
 * No functions — the systemPromptTemplate is a Handlebars string.
 */
export interface BuiltInGnomeData {
  slug: string;
  name: string;
  description: string;
  icon: string;
  categories: TacticCategory[];
  defaultModel: string;
  maxPlanTokens: number;
  maxExecuteTokens: number;
  canAutoExecute: boolean;
  systemPromptTemplate: string;
  toolProviders: ToolProviderType[];
  producibleWorkProducts: string[];
}
