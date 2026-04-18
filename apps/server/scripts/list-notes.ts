/**
 * list-notes — read access to the ScriptNote table.
 *
 * ScriptNote captures reviewer notes flagged from the player while watching
 * scripts play back (see docs/ARCHITECTURE.md and schema.prisma). Most notes
 * point at template tweaks that should be addressed during prompt/template
 * iteration. There is no GET endpoint on /api/notes by design — notes are
 * internal tuning instrumentation, not a user surface — so this script is
 * how Claude (and humans) read them.
 *
 * === For future Claude sessions ===
 *
 * When the user references "script notes", "the notes table", "things I
 * flagged while watching", "the feedback I left on template X", etc., run
 * this script to retrieve them. Do NOT invent a new query path or add a
 * GET endpoint — this script is the canonical read surface.
 *
 * From the repo root:
 *   npx tsx scripts/list-notes.ts   (run from apps/server/) [options]
 *
 * Options (all optional; combine freely):
 *   --status <s>      Filter by status: open | in-progress | resolved | wontfix | all  (default: open)
 *   --suspect <a>     Filter by suspectArea: analysis | script | template | untagged | all  (default: all)
 *   --template <id>   Filter by sceneTemplate (e.g. code-cloud, flow-diagram)
 *   --script <id>     Filter by scriptId
 *   --repo <url>      Filter by repoUrl (substring match)
 *   --since <iso>     Only notes created at/after this ISO date (e.g. 2026-04-01)
 *   --limit <n>       Cap result count (default: 100)
 *   --json            Emit JSON instead of the human-readable table
 *
 * Examples:
 *   # All open notes, newest first (the default)
 *   npx tsx scripts/list-notes.ts   (run from apps/server/)
 *
 *   # Everything flagged against code-cloud, including resolved ones
 *   npx tsx scripts/list-notes.ts   (run from apps/server/) --template code-cloud --status all
 *
 *   # Open notes for a specific script, JSON for piping
 *   npx tsx scripts/list-notes.ts   (run from apps/server/) --script clx123abc --json
 *
 * To mutate status (mark something resolved), edit the row in pgAdmin or
 * via a one-off `prisma.scriptNote.update(...)`. This script is read-only
 * on purpose — status transitions should be a deliberate act.
 */

import { prisma } from '../lib/prisma';

type Args = {
  status: string;
  suspect: string;
  template?: string;
  script?: string;
  repo?: string;
  since?: string;
  limit: number;
  json: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { status: 'open', suspect: 'all', limit: 100, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--status': out.status = next(); break;
      case '--suspect': out.suspect = next(); break;
      case '--template': out.template = next(); break;
      case '--script': out.script = next(); break;
      case '--repo': out.repo = next(); break;
      case '--since': out.since = next(); break;
      case '--limit': out.limit = Number(next()); break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h':
        console.log('See the header of scripts/list-notes.ts for usage.');
        process.exit(0);
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(1);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();

  const where: Record<string, unknown> = {};
  if (args.status !== 'all') where.status = args.status;
  if (args.suspect !== 'all') {
    where.suspectArea = args.suspect === 'untagged' ? null : args.suspect;
  }
  if (args.template) where.sceneTemplate = args.template;
  if (args.script) where.scriptId = args.script;
  if (args.repo) where.repoUrl = { contains: args.repo };
  if (args.since) where.createdAt = { gte: new Date(args.since) };

  const rows = await prisma.scriptNote.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: args.limit,
  });

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('No notes match the filter.');
    return;
  }

  for (const r of rows) {
    const when = r.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    const suspect = (r.suspectArea ?? '-').padEnd(8);
    console.log(
      `[${when}] ${r.status.padEnd(11)} ${suspect} ${r.sceneTemplate.padEnd(18)} scene#${r.sceneIndex} (${r.sceneId})`,
    );
    console.log(`  script: ${r.scriptLabel ?? r.scriptId ?? '(none)'}`);
    if (r.repoUrl) console.log(`  repo:   ${r.repoUrl}`);
    console.log(`  id:     ${r.id}`);
    console.log(`  note:   ${r.note}`);
    console.log('');
  }
  console.log(`${rows.length} note(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
