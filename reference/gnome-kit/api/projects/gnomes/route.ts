import { withAuthHandler, withServiceHandler, parseBody, getSearchParams } from "@/lib/api-utils";
import { GnomeService } from "@/services";
import type { TacticCategory } from "@prisma/client";

type Params = { params: Promise<{ slug: string }> };

// GET /api/projects/:slug/gnomes
// Returns effective gnomes (DB + built-in defaults merged).
// Optional query: ?category=SOCIAL_MEDIA
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const search = getSearchParams(request);

  // If ?effective=true (default), return merged list including virtual built-ins
  if (search.effective !== "false") {
    return withAuthHandler(async () => {
      // Need to resolve project ID from slug
      const { prisma } = await import("@/lib/prisma");
      const project = await prisma.project.findFirst({ where: { slug } });
      if (!project) throw new Error("Project not found");

      const gnomes = await GnomeService.getEffectiveGnomes(project.id);
      if (search.category) {
        return gnomes.filter((g) => g.categories.includes(search.category as TacticCategory));
      }
      return gnomes;
    });
  }

  // Otherwise return only DB gnomes for this project
  return withAuthHandler(() =>
    GnomeService.listGnomes({
      projectSlug: slug,
      category: search.category as TacticCategory | undefined,
    }),
  );
}

// POST /api/projects/:slug/gnomes
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const body = await parseBody<Omit<GnomeService.CreateGnomeInput, "projectSlug">>(request);
  if (!body) return withServiceHandler(() => { throw new Error("Invalid request body"); });
  return withAuthHandler((userId) => GnomeService.createGnome({ ...body, projectSlug: slug }), 201);
}
