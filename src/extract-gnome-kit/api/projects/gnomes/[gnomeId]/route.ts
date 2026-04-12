import { withAuthHandler, withServiceHandler, parseBody } from "@/lib/api-utils";
import { GnomeService } from "@/services";

type Params = { params: Promise<{ slug: string; gnomeId: string }> };

// GET /api/projects/:slug/gnomes/:gnomeId
export async function GET(_request: Request, { params }: Params) {
  const { gnomeId } = await params;

  // Handle virtual built-in IDs (e.g. "builtin:social-media-gnome")
  if (gnomeId.startsWith("builtin:")) {
    const builtInSlug = gnomeId.replace("builtin:", "");
    const { getBuiltInGnome } = await import("@/agents/defaults");
    const builtIn = getBuiltInGnome(builtInSlug);
    if (!builtIn) return withServiceHandler(() => { throw new Error("Built-in gnome not found"); });
    return withAuthHandler(() => Promise.resolve({
      id: gnomeId,
      ...builtIn,
      isBuiltIn: true,
      builtInSlug: builtIn.slug,
      version: 0,
      isVirtual: true,
    }));
  }

  return withAuthHandler(() => GnomeService.getGnome(gnomeId));
}

// PUT /api/projects/:slug/gnomes/:gnomeId
// For virtual built-ins, this triggers copy-on-write.
export async function PUT(request: Request, { params }: Params) {
  const { slug, gnomeId } = await params;
  const body = await parseBody<GnomeService.UpdateGnomeInput>(request);
  if (!body) return withServiceHandler(() => { throw new Error("Invalid request body"); });

  // Copy-on-write for virtual built-ins
  if (gnomeId.startsWith("builtin:")) {
    const builtInSlug = gnomeId.replace("builtin:", "");
    return withAuthHandler((userId) =>
      GnomeService.copyBuiltInToProject(builtInSlug, slug, { ...body, lastEditedBy: userId }),
      201,
    );
  }

  return withAuthHandler((userId) =>
    GnomeService.updateGnome(gnomeId, { ...body, lastEditedBy: userId }),
  );
}

// DELETE /api/projects/:slug/gnomes/:gnomeId
export async function DELETE(_request: Request, { params }: Params) {
  const { gnomeId } = await params;

  // Cannot delete virtual built-ins
  if (gnomeId.startsWith("builtin:")) {
    return withServiceHandler(() => { throw new Error("Cannot delete a built-in gnome"); });
  }

  return withAuthHandler(() => GnomeService.deleteGnome(gnomeId));
}
