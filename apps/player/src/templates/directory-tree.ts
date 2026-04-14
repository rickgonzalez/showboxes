import type { Template, TemplateHandle } from './registry';

/**
 * directory-tree — renders repository structure. The "zoom out and see
 * the whole thing" scene: where the code lives, how a monorepo is
 * organized, which directories/files matter.
 *
 * Calm template — the tree expands depth-by-depth once, then holds
 * still. No continuous motion.
 *
 * Slot schema:
 *   root:     string            — repo/root label shown at the top
 *   tree:     TreeNode[]        — top-level entries
 *   maxDepth: number            — collapse depth beyond this (default 3)
 *   staggerMs: number           — per-depth reveal delay (default 200)
 *   style:    "tree" | "indented" | "explorer"  (default "tree")
 *
 * TreeNode:
 *   name:      string
 *   badge?:    string           — small pill next to the name
 *   note?:     string           — dim caption to the right
 *   highlight?: boolean         — accent border + subtle glow
 *   children?: TreeNode[]
 */

interface TreeNode {
  name: string;
  badge?: string;
  note?: string;
  highlight?: boolean;
  children?: TreeNode[];
}

interface DirectoryTreeContent {
  root?: string;
  tree: TreeNode[];
  maxDepth?: number;
  staggerMs?: number;
  style?: 'tree' | 'indented' | 'explorer';
}

type TreeStyle = 'tree' | 'indented' | 'explorer';

const FOLDER_ICON = '\u{1F4C1}';   // 📁
const FILE_ICON = '\u{1F4C4}';     // 📄

export const directoryTreeTemplate: Template = {
  id: 'directory-tree',
  description:
    'Repository/directory structure view. For showing how a project is organized, which folders matter. Calm/static after the depth-stagger reveal.',
  slots: {
    root: 'string — optional root label shown at the top',
    tree: 'TreeNode[] — { name, badge?, note?, highlight?, children? }',
    maxDepth: 'number — collapse deeper levels (default 3)',
    staggerMs: 'number — per-depth reveal delay (default 200)',
    style: '"tree" | "indented" | "explorer" (default "tree")',
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as DirectoryTreeContent;
    const {
      root,
      tree = [],
      maxDepth = 3,
      staggerMs = 200,
      style = 'tree',
    } = content;

    const wrapper = document.createElement('div');
    wrapper.className = `sb-tree-wrapper sb-tree-style-${style}`;

    if (root) {
      const rootEl = document.createElement('div');
      rootEl.className = 'sb-tree-root';
      rootEl.textContent = root;
      wrapper.appendChild(rootEl);
    }

    const list = document.createElement('div');
    list.className = 'sb-tree-list';
    wrapper.appendChild(list);

    const rowsByDepth: HTMLElement[][] = [];
    const rowByPath = new Map<string, HTMLElement>();

    const renderNodes = (
      nodes: TreeNode[],
      depth: number,
      ancestorPath: string,
      ancestorLastFlags: boolean[],
    ) => {
      if (depth > maxDepth) {
        if (nodes.length > 0) {
          const more = document.createElement('div');
          more.className = 'sb-tree-row sb-tree-more';
          more.textContent =
            (style === 'tree' ? buildPrefix(ancestorLastFlags, true, style) : indentPrefix(depth, style)) +
            `… ${nodes.length} more`;
          list.appendChild(more);
          pushRow(rowsByDepth, depth, more);
        }
        return;
      }

      nodes.forEach((node, i) => {
        const isLast = i === nodes.length - 1;
        const path = ancestorPath ? `${ancestorPath}/${node.name}` : node.name;
        const row = buildRow(node, depth, ancestorLastFlags, isLast, style);
        list.appendChild(row);
        pushRow(rowsByDepth, depth, row);
        rowByPath.set(path, row);
        rowByPath.set(node.name, row);

        if (node.children && node.children.length > 0) {
          renderNodes(
            node.children,
            depth + 1,
            path,
            [...ancestorLastFlags, isLast],
          );
        }
      });
    };

    renderNodes(tree, 0, '', []);

    presenter.domRoot.appendChild(wrapper);

    // Depth-by-depth stagger reveal. After all depths are visible, no
    // further motion — the tree just sits there.
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    rowsByDepth.forEach((rows, depth) => {
      const delay = 150 + depth * staggerMs;
      rows.forEach((row, idx) => {
        const t = setTimeout(
          () => row.classList.add('sb-visible'),
          delay + idx * 30,
        );
        timeouts.push(t);
      });
    });

    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize: (target) => {
        if (!target) return;
        const match =
          rowByPath.get(target) ??
          findRowByName(rowByPath, target);
        if (match) {
          match.classList.add('sb-tree-active');
          setTimeout(() => match.classList.remove('sb-tree-active'), 1800);
        }
      },
    };
    return handle;
  },
};

function pushRow(rowsByDepth: HTMLElement[][], depth: number, row: HTMLElement): void {
  if (!rowsByDepth[depth]) rowsByDepth[depth] = [];
  rowsByDepth[depth].push(row);
}

function findRowByName(
  rowByPath: Map<string, HTMLElement>,
  target: string,
): HTMLElement | undefined {
  const lower = target.toLowerCase();
  for (const [key, el] of rowByPath) {
    if (key.toLowerCase().endsWith(lower)) return el;
  }
  return undefined;
}

function buildRow(
  node: TreeNode,
  depth: number,
  ancestorLastFlags: boolean[],
  isLast: boolean,
  style: TreeStyle,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sb-tree-row';
  if (node.highlight) row.classList.add('sb-tree-highlight');

  const prefix = document.createElement('span');
  prefix.className = 'sb-tree-prefix';
  prefix.textContent =
    style === 'tree'
      ? buildPrefix(ancestorLastFlags, isLast, style)
      : indentPrefix(depth, style);
  row.appendChild(prefix);

  const isFolder = !!node.children || node.name.endsWith('/');
  if (style === 'explorer') {
    const icon = document.createElement('span');
    icon.className = 'sb-tree-icon';
    icon.textContent = isFolder ? FOLDER_ICON : FILE_ICON;
    row.appendChild(icon);
  }

  const name = document.createElement('span');
  name.className = isFolder ? 'sb-tree-name sb-tree-folder' : 'sb-tree-name sb-tree-file';
  name.textContent = node.name;
  row.appendChild(name);

  if (node.badge) {
    const badge = document.createElement('span');
    badge.className = 'sb-tree-badge';
    badge.textContent = node.badge;
    row.appendChild(badge);
  }

  if (node.note) {
    const note = document.createElement('span');
    note.className = 'sb-tree-note';
    note.textContent = node.note;
    row.appendChild(note);
  }

  return row;
}

function buildPrefix(
  ancestorLastFlags: boolean[],
  isLast: boolean,
  _style: TreeStyle,
): string {
  // Classic tree notation: │   for open ancestors, "    " for closed,
  // ├── for intermediate, └── for the last child.
  let out = '';
  for (const last of ancestorLastFlags) {
    out += last ? '    ' : '\u2502   ';
  }
  if (ancestorLastFlags.length === 0 && isLast === undefined) return out;
  out += isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
  return out;
}

function indentPrefix(depth: number, _style: TreeStyle): string {
  return '  '.repeat(depth);
}
