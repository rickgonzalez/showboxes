/**
 * Phase 5 — Platform tools entry point.
 *
 * Importing this module triggers the side-effect registration of every
 * platform/built-in tool into the registry in `./registry.ts`. Both
 * `sync.ts → buildAgentBody` (read at sync time) and
 * `agent.session.service.ts → dispatchPlatformToolCall` (read at dispatch time)
 * MUST import this file before they touch the registry, otherwise the map
 * will be empty.
 *
 * Order matters only for stability of the `tools[]` array on the remote
 * Managed Agent — the seed script will version-bump every gnome on each run
 * if the order shifts. Keep this list sorted: built-ins first (the three
 * credential-less groups), then platform stubs/integrations alphabetically.
 */

// Built-ins (credential-less)
import "./providers/web-search";
import "./providers/media-library";
import "./providers/ai-image-generation";

// Platform integrations (alphabetical)
import "./providers/app-store";
import "./providers/discord";
import "./providers/google-analytics";
import "./providers/instagram";
import "./providers/steam";
import "./providers/twitter";

export {
  registerPlatformTool,
  getPlatformToolByName,
  getAllToolsForProviders,
} from "./registry";
export type { PlatformTool, PlatformToolContext } from "./types";
