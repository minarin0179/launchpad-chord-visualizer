/** シード固定の疑似乱数（mulberry32）。テスト入力を毎回同じにするために使う */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, n) の整数 */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)],
    chance: (p) => next() < p,
  };
}
