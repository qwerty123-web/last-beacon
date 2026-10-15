/**
 * Dijkstra's shortest-path algorithm over the runtime road graph with a binary-heap priority queue.
 * Edge weights come from a caller-supplied cost function; returning Infinity (or null) excludes the edge.
 * Ties are broken by node id so results are deterministic.
 */
import type { RuntimeEdge, RuntimeGraph } from './graph';

export type EdgeWeight = (e: RuntimeEdge) => number | null;

export interface PathResult {
  nodes: string[];
  edges: string[];
  cost: number;
}

class Heap {
  private a: Array<[number, string]> = [];
  get size() {
    return this.a.length;
  }
  private less(i: number, j: number) {
    const x = this.a[i];
    const y = this.a[j];
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }
  push(item: [number, string]) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): [number, string] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export interface Tree {
  dist: Map<string, number>;
  prev: Map<string, { node: string; edge: string }>;
}

/** Single-source shortest-path tree (optionally stopping early at `target`). */
export function dijkstraTree(g: RuntimeGraph, source: string, weight: EdgeWeight, target?: string): Tree {
  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, { node: string; edge: string }>();
  const done = new Set<string>();
  const heap = new Heap();
  heap.push([0, source]);
  while (heap.size) {
    const [d, u] = heap.pop()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === target) break;
    for (const { edge, to } of g.adj.get(u) ?? []) {
      if (done.has(to)) continue;
      const e = g.edges.get(edge)!;
      const w = weight(e);
      if (w === null || !isFinite(w)) continue;
      if (w < 0) throw new Error('Dijkstra requires non-negative weights');
      const nd = d + w;
      const cur = dist.get(to);
      if (cur === undefined || nd < cur || (nd === cur && edge < (prev.get(to)?.edge ?? '~'))) {
        dist.set(to, nd);
        prev.set(to, { node: u, edge });
        heap.push([nd, to]);
      }
    }
  }
  return { dist, prev };
}

export function extractPath(tree: Tree, source: string, target: string): PathResult | null {
  if (!tree.dist.has(target)) return null;
  const nodes = [target];
  const edges: string[] = [];
  let cur = target;
  while (cur !== source) {
    const p = tree.prev.get(cur);
    if (!p) return null;
    edges.push(p.edge);
    nodes.push(p.node);
    cur = p.node;
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, cost: tree.dist.get(target)! };
}

export function dijkstra(g: RuntimeGraph, source: string, target: string, weight: EdgeWeight): PathResult | null {
  if (source === target) return { nodes: [source], edges: [], cost: 0 };
  return extractPath(dijkstraTree(g, source, weight, target), source, target);
}
