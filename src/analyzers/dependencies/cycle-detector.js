/**
 * Cycle Detector
 *
 * Uses iterative DFS with an explicit recursion stack to find all simple
 * cycles in a directed dependency graph.
 *
 * A "simple cycle" is a cycle where no node appears twice in the path.
 * Each unique cycle is reported exactly once — regardless of which node
 * is used as the starting point — by normalising every cycle to start
 * with its lexicographically smallest member.
 *
 * Result:
 *   Array of cycle paths, e.g.:
 *     [ ['/src/a.js', '/src/b.js', '/src/c.js'] ]
 *   meaning: a → b → c → a
 */

/**
 * Detect all unique simple cycles in a directed graph.
 *
 * @param {Map<string, Set<string>>} graph — adjacency map (node → Set of neighbours)
 * @returns {string[][]} — array of cycle paths (each path excludes the repeated start node)
 */
export function detectCycles(graph) {
  // Node colours: 0 = unvisited, 1 = on current stack, 2 = fully processed
  const color   = new Map();
  const parent  = new Map();

  for (const node of graph.keys()) color.set(node, 0);

  const rawCycles = [];

  function dfs(node, path) {
    color.set(node, 1);
    path.push(node);

    for (const neighbour of graph.get(node) ?? []) {
      if (!color.has(neighbour)) continue; // edge to unanalysed node

      if (color.get(neighbour) === 1) {
        // Back edge → cycle found. Extract from path.
        const cycleStart = path.indexOf(neighbour);
        if (cycleStart !== -1) {
          rawCycles.push(path.slice(cycleStart));
        }
        continue;
      }

      if (color.get(neighbour) === 0) {
        dfs(neighbour, path);
      }
    }

    path.pop();
    color.set(node, 2);
  }

  for (const node of graph.keys()) {
    if (color.get(node) === 0) {
      dfs(node, []);
    }
  }

  // Deduplicate: normalise each cycle by rotating to start at its
  // lexicographically smallest element, then stringify for uniqueness.
  const seen = new Set();
  const unique = [];

  for (const cycle of rawCycles) {
    const canonical = _canonicalize(cycle);
    const key = canonical.join('→');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(canonical);
    }
  }

  return unique;
}

/**
 * Rotate a cycle array so it starts at the lexicographically smallest element.
 */
function _canonicalize(cycle) {
  if (cycle.length === 0) return cycle;
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

/**
 * Build a human-readable label for a cycle path, using short relative names.
 *
 * @param {string[]} cycle   — absolute file paths
 * @param {string}   rootDir — project root for path shortening
 * @returns {string}         — e.g. "a.js → b.js → c.js → a.js"
 */
export function formatCycle(cycle, rootDir) {
  const shorten = (p) => {
    const rel = p.startsWith(rootDir) ? p.slice(rootDir.length + 1) : p;
    return rel;
  };
  const labels = cycle.map(shorten);
  return [...labels, labels[0]].join(' → ');
}
