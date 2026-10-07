import { mulberry32 } from './rng';

interface TreeNode {
  size: number;
  feature?: number;
  split?: number;
  left?: TreeNode;
  right?: TreeNode;
}

const EULER = 0.5772156649;

/** c(n): average path length of an unsuccessful BST search (Liu, Ting & Zhou 2008). */
export function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

export interface IsolationForestOptions {
  trees?: number;
  sampleSize?: number;
  seed?: number;
}

/** Isolation Forest: anomalies are isolated by fewer random splits. Score s = 2^(−E[h(x)]/c(ψ)). */
export class IsolationForest {
  private readonly nTrees: number;
  private readonly sampleSize: number;
  private readonly rnd: () => number;
  private trees: TreeNode[] = [];
  private psi = 0;

  constructor(opts: IsolationForestOptions = {}) {
    this.nTrees = opts.trees ?? 100;
    this.sampleSize = opts.sampleSize ?? 256;
    this.rnd = mulberry32(opts.seed ?? 42);
  }

  fit(X: number[][]): this {
    const n = X.length;
    this.psi = Math.min(this.sampleSize, n);
    const limit = Math.ceil(Math.log2(Math.max(2, this.psi)));
    const idx = X.map((_, i) => i);
    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      // Partial Fisher–Yates: first psi entries become a sample without replacement.
      for (let i = 0; i < this.psi; i++) {
        const j = i + Math.floor(this.rnd() * (n - i));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      this.trees.push(this.build(idx.slice(0, this.psi).map((i) => X[i]), 0, limit));
    }
    return this;
  }

  private build(rows: number[][], depth: number, limit: number): TreeNode {
    if (depth >= limit || rows.length <= 1) return { size: rows.length };
    const dims = rows[0].length;
    const candidates: { f: number; min: number; max: number }[] = [];
    for (let f = 0; f < dims; f++) {
      let min = Infinity;
      let max = -Infinity;
      for (const r of rows) {
        if (r[f] < min) min = r[f];
        if (r[f] > max) max = r[f];
      }
      if (max > min) candidates.push({ f, min, max });
    }
    if (candidates.length === 0) return { size: rows.length };
    const c = candidates[Math.floor(this.rnd() * candidates.length)];
    const split = c.min + this.rnd() * (c.max - c.min);
    const left: number[][] = [];
    const right: number[][] = [];
    for (const r of rows) (r[c.f] < split ? left : right).push(r);
    return {
      size: rows.length,
      feature: c.f,
      split,
      left: this.build(left, depth + 1, limit),
      right: this.build(right, depth + 1, limit),
    };
  }

  private pathLength(x: number[], node: TreeNode, depth: number): number {
    if (node.feature === undefined) return depth + averagePathLength(node.size);
    return this.pathLength(x, x[node.feature] < node.split! ? node.left! : node.right!, depth + 1);
  }

  score(X: number[][]): number[] {
    const c = averagePathLength(this.psi);
    if (c === 0 || this.trees.length === 0) return X.map(() => 0.5);
    return X.map((x) => {
      let total = 0;
      for (const tree of this.trees) total += this.pathLength(x, tree, 0);
      return 2 ** (-(total / this.trees.length) / c);
    });
  }
}
