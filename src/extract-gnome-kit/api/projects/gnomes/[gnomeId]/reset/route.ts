import { withAuthHandler } from "@/lib/api-utils";
import { GnomeService } from "@/services";

type Params = { params: Promise<{ slug: string; gnomeId: string }> };

// POST /api/projects/:slug/gnomes/:gnomeId/reset
// Reset a customized built-in gnome back to its canonical defaults.
export async function POST(_request: Request, { params }: Params) {
  const { gnomeId } = await params;
  return withAuthHandler(() => GnomeService.resetGnomeToDefault(gnomeId));
}
