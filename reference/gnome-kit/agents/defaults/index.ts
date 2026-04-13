// Built-in Gnome Registry
// Pure data defaults — no functions. Used as virtual entries when
// no user-customized gnome exists in the database.

import type { BuiltInGnomeData } from "./types";
import type { TacticCategory } from "@prisma/client";
import { socialMediaGnome } from "./social-media.defaults";
import { communityGnome } from "./community.defaults";
import { storePresenceGnome } from "./store-presence.defaults";
import { contentMarketingGnome } from "./content-marketing.defaults";
import { generalGnome } from "./general.defaults";
import { loanProcessingGnome } from "./loan-processing.defaults";
import { designerGnome } from "./designer.defaults";
import { researchGnome } from "./research.defaults";

const allBuiltIns: BuiltInGnomeData[] = [
  socialMediaGnome,
  communityGnome,
  storePresenceGnome,
  contentMarketingGnome,
  generalGnome,
  loanProcessingGnome,
  designerGnome,
  researchGnome,
];

const bySlug = new Map<string, BuiltInGnomeData>();
const byCategory = new Map<TacticCategory, BuiltInGnomeData>();

for (const gnome of allBuiltIns) {
  bySlug.set(gnome.slug, gnome);
  for (const cat of gnome.categories) {
    byCategory.set(cat, gnome);
  }
}

/** Get all shipped built-in gnome definitions. */
export function getAllBuiltInGnomes(): BuiltInGnomeData[] {
  return allBuiltIns;
}

/** Get a specific built-in gnome by slug. */
export function getBuiltInGnome(slug: string): BuiltInGnomeData | undefined {
  return bySlug.get(slug);
}

/** Get the built-in gnome for a tactic category. */
export function getBuiltInGnomeForCategory(category: TacticCategory): BuiltInGnomeData | undefined {
  return byCategory.get(category);
}

export type { BuiltInGnomeData } from "./types";
