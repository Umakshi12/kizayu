// Word Hunt (word search) generator and selection logic. Pure, no React.

export type Pos = readonly [row: number, col: number];
export interface Placed { word: string; cells: Pos[] }
export interface Puzzle { size: number; grid: string[][]; placed: Placed[] }

export const WORD_SETS: Record<string, string[]> = {
  Family: ["MOM", "DAD", "SISTER", "BROTHER", "GRANDMA", "UNCLE", "AUNT", "COUSIN", "BABY", "HOME"],
  Food: ["APPLE", "MANGO", "RICE", "BREAD", "MILK", "HONEY", "DOSA", "SALAD", "TEA", "SOUP"],
  Nature: ["RIVER", "TREE", "FLOWER", "RAIN", "CLOUD", "MOON", "STAR", "OCEAN", "HILL", "LEAF"],
};

const DIRS: Pos[] = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];

/** Small seeded RNG so puzzles are reproducible in tests. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(words: string[], size = 9, rng: () => number = Math.random): Puzzle {
  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(""));
  const placed: Placed[] = [];
  const sorted = [...new Set(words.map(w => w.toUpperCase().replace(/[^A-Z]/g, "")))].filter(w => w.length > 1 && w.length <= size).sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const [dr, dc] = DIRS[Math.floor(rng() * DIRS.length)];
      const r0 = Math.floor(rng() * size), c0 = Math.floor(rng() * size);
      const cells: Pos[] = [];
      let ok = true;
      for (let k = 0; k < word.length; k++) {
        const r = r0 + dr * k, c = c0 + dc * k;
        if (r < 0 || c < 0 || r >= size || c >= size || (grid[r][c] && grid[r][c] !== word[k])) { ok = false; break; }
        cells.push([r, c]);
      }
      if (!ok) continue;
      cells.forEach(([r, c], k) => { grid[r][c] = word[k]; });
      placed.push({ word, cells });
      break;
    }
  }
  const ABC = "ABCDEFGHIJKLMNOPRSTUVWY";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) grid[r][c] = ABC[Math.floor(rng() * ABC.length)];
  return { size, grid, placed };
}

/** Cells on the straight line from a to b (row, column or 45° diagonal), or null if not a straight line. */
export function lineCells(a: Pos, b: Pos): Pos[] | null {
  const dr = b[0] - a[0], dc = b[1] - a[1];
  if (dr === 0 && dc === 0) return [a];
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
  const n = Math.max(Math.abs(dr), Math.abs(dc));
  const sr = Math.sign(dr), sc = Math.sign(dc);
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + sr * k, a[1] + sc * k] as Pos);
}

const same = (x: Pos[], y: Pos[]) => x.length === y.length && x.every((p, i) => p[0] === y[i][0] && p[1] === y[i][1]);

/** Returns the word found by selecting a→b (either direction), or null. */
export function findWord(p: Puzzle, a: Pos, b: Pos, alreadyFound: string[] = []): Placed | null {
  const cells = lineCells(a, b);
  if (!cells || cells.length < 2) return null;
  return p.placed.find(w => !alreadyFound.includes(w.word) && (same(w.cells, cells) || same(w.cells, [...cells].reverse()))) ?? null;
}

/** Score: 10 points per letter found, plus a time bonus if every word is found. */
export function score(found: Placed[], total: number, seconds: number): number {
  const base = found.reduce((s, w) => s + w.word.length * 10, 0);
  const bonus = found.length === total ? Math.max(0, 300 - seconds) : 0;
  return base + bonus;
}
