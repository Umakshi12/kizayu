// Question and pattern generators for Brain Gym. Everything is driven by a seeded random function, so the Daily Challenge
// gives every person in the family exactly the same questions on the same day.

export type Rand = () => number;

/** Small, fast seeded random number generator (mulberry32). Returns numbers in [0, 1). */
export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);
export const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = <T,>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)];
export function shuffle<T>(r: Rand, list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ------------------------------------------------------------------ Mental Math Sprint
export interface MathQuestion { text: string; answer: number; options: number[] }

/** Four answer choices that include the right one and look believable. */
function numberOptions(r: Rand, answer: number): number[] {
  const set = new Set<number>([answer]);
  const spread = Math.max(3, Math.round(Math.abs(answer) * 0.15));
  let guard = 0;
  while (set.size < 4 && guard++ < 50) {
    const wrong = answer + (r() < 0.5 ? -1 : 1) * int(r, 1, spread);
    if (wrong >= 0 || answer < 0) set.add(wrong);
  }
  while (set.size < 4) set.add(answer + set.size);
  return shuffle(r, [...set]);
}

/** Level 1 is single digit sums; level 6 mixes operations. Difficulty rises as the player gets answers right. */
export function mathQuestion(r: Rand, level: number): MathQuestion {
  const L = Math.max(1, Math.min(6, level));
  let text: string, answer: number;
  const kind = L === 1 ? "add" : L === 2 ? pick(r, ["add", "sub"]) : L === 3 ? pick(r, ["add", "sub", "mul"]) : L === 4 ? pick(r, ["sub", "mul", "mul", "add"]) : L === 5 ? pick(r, ["mul", "div", "sub", "add"]) : pick(r, ["two", "div", "mul", "two"]);
  switch (kind) {
    case "add": { const m = L === 1 ? 9 : L <= 3 ? 40 : 99; const a = int(r, 2, m), b = int(r, 2, m); text = `${a} + ${b}`; answer = a + b; break; }
    case "sub": { const m = L <= 2 ? 30 : 99; const a = int(r, 10, m), b = int(r, 2, a - 1); text = `${a} − ${b}`; answer = a - b; break; }
    case "mul": { const m = L <= 3 ? 9 : 12; const a = int(r, 2, m), b = int(r, 2, m); text = `${a} × ${b}`; answer = a * b; break; }
    case "div": { const b = int(r, 2, 12), q = int(r, 2, L >= 6 ? 15 : 12); text = `${b * q} ÷ ${b}`; answer = q; break; }
    default: { const a = int(r, 2, 30), b = int(r, 2, 9), c = int(r, 2, 9); text = `${a} + ${b} × ${c}`; answer = a + b * c; }
  }
  return { text, answer, options: numberOptions(r, answer) };
}

/** Level goes up by one for every 4 correct answers, up to 6. */
export const mathLevel = (correct: number) => Math.min(6, 1 + Math.floor(correct / 4));

// ------------------------------------------------------------------ Focus (Stroop) test
export const STROOP_COLORS = [
  { name: "Red", hex: "#E5334F" }, { name: "Blue", hex: "#2D6BFF" }, { name: "Green", hex: "#18A867" },
  { name: "Yellow", hex: "#E3A400" }, { name: "Purple", hex: "#8A4DFF" },
] as const;
export interface StroopTrial { word: string; ink: string; inkName: string }

/** The word names one colour but is printed in another (most of the time). Tap the ink colour, not the word. */
export function stroopTrial(r: Rand): StroopTrial {
  const word = pick(r, STROOP_COLORS);
  const ink = r() < 0.75 ? pick(r, STROOP_COLORS.filter(c => c.name !== word.name)) : word;
  return { word: word.name, ink: ink.hex, inkName: ink.name };
}

// ------------------------------------------------------------------ Spatial Memory Matrix
export interface MatrixRound { size: number; tiles: number[] }

/** Level 1 shows 3 tiles on a 3x3 grid. The grid grows and more tiles light up as you level up. */
export function matrixRound(r: Rand, level: number): MatrixRound {
  const size = level <= 4 ? 3 : level <= 9 ? 4 : level <= 15 ? 5 : 6;
  const count = Math.min(level + 2, Math.floor((size * size) / 2));
  const cells = shuffle(r, Array.from({ length: size * size }, (_, i) => i));
  return { size, tiles: cells.slice(0, count).sort((a, b) => a - b) };
}

// ------------------------------------------------------------------ Quant and aptitude puzzles
export interface QuantQuestion { text: string; options: string[]; answerIndex: number; explain: string }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Builds a multiple choice question from the right answer and a few believable wrong ones. */
function choice(r: Rand, text: string, answer: number, explain: string, wrong?: number[], unit = ""): QuantQuestion {
  const set = new Set<number>([answer]);
  for (const w of wrong ?? []) if (w !== answer && w >= 0) set.add(w);
  const spread = Math.max(2, Math.round(Math.abs(answer) * 0.2));
  let guard = 0;
  while (set.size < 4 && guard++ < 60) { const w = answer + (r() < 0.5 ? -1 : 1) * int(r, 1, spread); if (w >= 0) set.add(w); }
  while (set.size < 4) set.add(answer + 10 * set.size);
  const opts = shuffle(r, [...set].slice(0, 4));
  return { text, options: opts.map(o => `${fmt(o)}${unit}`), answerIndex: opts.indexOf(answer), explain };
}

const BUILDERS: ((r: Rand) => QuantQuestion)[] = [
  // number series: add a constant
  r => { const a = int(r, 2, 20), d = int(r, 2, 9), s = [0, 1, 2, 3, 4].map(i => a + i * d); return choice(r, `What comes next?\n${s.join(", ")}, ?`, a + 5 * d, `It goes up by ${d} each time, so the next number is ${a + 5 * d}.`, [a + 5 * d + d, a + 5 * d - 1]); },
  // number series: multiply
  r => { const a = int(r, 1, 5), m = int(r, 2, 3), s = [0, 1, 2, 3].map(i => a * m ** i); return choice(r, `What comes next?\n${s.join(", ")}, ?`, a * m ** 4, `Each number is ${m} times the one before. ${s[3]} × ${m} = ${a * m ** 4}.`, [s[3] + m, a * m ** 4 + a]); },
  // number series: alternating steps
  r => { const a = int(r, 3, 15), x = int(r, 2, 6), y = int(r, 1, 4), s = [a, a + x, a + x + y, a + 2 * x + y, a + 2 * x + 2 * y]; return choice(r, `What comes next?\n${s.join(", ")}, ?`, a + 3 * x + 2 * y, `The steps alternate: +${x}, +${y}, +${x}, +${y}, so next is +${x}.`, [a + 2 * x + 3 * y, a + 3 * x + 3 * y]); },
  // percentage of a number
  r => { const p = pick(r, [10, 15, 20, 25, 30, 40, 50, 60, 75]), n = pick(r, [40, 60, 80, 120, 160, 200, 240, 400]); return choice(r, `What is ${p}% of ${n}?`, (p * n) / 100, `${p}% of ${n} = ${p} × ${n} ÷ 100 = ${(p * n) / 100}.`); },
  // percentage change
  r => { const price = pick(r, [200, 400, 500, 800, 1000]), off = pick(r, [10, 20, 25, 30, 40]); return choice(r, `A bag costs ₹${price}. It gets a ${off}% discount. What is the new price?`, price - (price * off) / 100, `Discount = ${off}% of ${price} = ${(price * off) / 100}. So ${price} − ${(price * off) / 100} = ${price - (price * off) / 100}.`, [price + (price * off) / 100, (price * off) / 100], ""); },
  // ratio split
  r => { const a = int(r, 1, 4), b = int(r, a + 1, 6), k = int(r, 3, 12), total = (a + b) * k; return choice(r, `Share ₹${total} between two people in the ratio ${a}:${b}. How much does the larger share get?`, b * k, `Total parts = ${a + b}. One part = ${total} ÷ ${a + b} = ${k}. Larger share = ${b} × ${k} = ${b * k}.`, [a * k, total / 2]); },
  // speed distance time
  r => { const v = pick(r, [30, 40, 45, 50, 60, 75]), t = pick(r, [2, 3, 4, 5]); return choice(r, `A bus travels at ${v} km/h for ${t} hours. How far does it go (in km)?`, v * t, `Distance = speed × time = ${v} × ${t} = ${v * t} km.`, [v + t, v * (t + 1)]); },
  r => { const v = pick(r, [20, 30, 40, 60]), t = pick(r, [2, 3, 4, 5]), d = v * t; return choice(r, `A car covers ${d} km in ${t} hours. What is its speed (in km/h)?`, v, `Speed = distance ÷ time = ${d} ÷ ${t} = ${v} km/h.`, [d - t, v * 2]); },
  // average
  r => { const k = int(r, 3, 5), nums = Array.from({ length: k }, () => int(r, 10, 50)); const avg = Math.round(nums.reduce((s, x) => s + x, 0) / k); const adj = nums.map((x, i) => (i === k - 1 ? x + (avg * k - nums.reduce((s, y) => s + y, 0)) : x)); return choice(r, `What is the average of ${adj.join(", ")}?`, avg, `Add them up: ${adj.reduce((s, x) => s + x, 0)}. Divide by ${k}: ${avg}.`); },
  // simple interest
  r => { const p = pick(r, [1000, 2000, 5000]), rate = pick(r, [5, 8, 10]), t = pick(r, [2, 3, 4]); return choice(r, `Simple interest on ₹${p} at ${rate}% a year for ${t} years?`, (p * rate * t) / 100, `Interest = P × R × T ÷ 100 = ${p} × ${rate} × ${t} ÷ 100 = ${(p * rate * t) / 100}.`, [(p * rate) / 100, p + (p * rate * t) / 100]); },
  // work and time
  r => { const [a, b, t] = pick(r, [[6, 3, 2], [10, 15, 6], [12, 6, 4], [15, 10, 6], [20, 5, 4], [12, 4, 3]] as const); return choice(r, `A can finish a job in ${a} days and B in ${b} days. Working together, how many days do they need?`, t, `Together they do 1/${a} + 1/${b} = ${a + b}/${a * b} of the job a day. So ${a * b}/${a + b} = ${t} days.`, [t + 1, t + 2]); },
  // missing number
  r => { const a = int(r, 3, 12), b = int(r, 3, 12), c = int(r, 5, 40); return choice(r, `Find the missing number:\n${a} × ? + ${c} = ${a * b + c}`, b, `${a * b + c} − ${c} = ${a * b}, and ${a * b} ÷ ${a} = ${b}.`, [b + 1, b - 1]); },
  // squares / patterns
  r => { const n = int(r, 4, 15); return choice(r, `${n}² − ${n - 1}² = ?`, 2 * n - 1, `The difference of two neighbouring squares is ${n} + ${n - 1} = ${2 * n - 1}.`, [2 * n, n]); },
  // age problem
  r => { const x = int(r, 6, 14), m = int(r, 2, 4), yrs = int(r, 3, 8); return choice(r, `A mother is ${m} times as old as her son. The son is ${x}. How old will the mother be in ${yrs} years?`, m * x + yrs, `Mother now: ${m} × ${x} = ${m * x}. After ${yrs} years: ${m * x + yrs}.`, [m * x, x + yrs]); },
  // clock angle (hour hand) simple
  r => { const h = pick(r, [2, 3, 4, 5, 6, 8, 9]); return choice(r, `What is the angle between the hands of a clock at ${h}:00?`, Math.min(h * 30, 360 - h * 30), `Each hour is 30°. At ${h}:00 the angle is ${h} × 30 = ${h * 30}°, and the smaller angle is ${Math.min(h * 30, 360 - h * 30)}°.`, [h * 15, 90], "°"); },
];

const LOGIC: QuantQuestion[] = [
  { text: "All roses are flowers. Some flowers fade quickly. Which is certainly true?", options: ["All roses fade quickly", "Some roses are flowers", "No flower fades slowly", "Some roses fade quickly"], answerIndex: 1, explain: "All roses are flowers, so some roses are flowers. The rest is not guaranteed." },
  { text: "Ravi is taller than Amit. Amit is taller than Neha. Who is the shortest?", options: ["Ravi", "Amit", "Neha", "Can't tell"], answerIndex: 2, explain: "Ravi > Amit > Neha, so Neha is the shortest." },
  { text: "If today is Wednesday, what day will it be 10 days from now?", options: ["Friday", "Saturday", "Thursday", "Sunday"], answerIndex: 1, explain: "10 days is 1 week and 3 days. Wednesday plus 3 days is Saturday." },
  { text: "Find the odd one out:\n8, 27, 64, 100, 125", options: ["27", "64", "100", "125"], answerIndex: 2, explain: "8, 27, 64 and 125 are perfect cubes. 100 is not." },
  { text: "Find the odd one out:\n2, 3, 5, 9, 11", options: ["2", "5", "9", "11"], answerIndex: 2, explain: "All the others are prime numbers. 9 is 3 × 3." },
  { text: "A is B's sister. B is C's father. How is A related to C?", options: ["Mother", "Aunt", "Cousin", "Grandmother"], answerIndex: 1, explain: "A is the sister of C's father, so A is C's aunt." },
  { text: "If CAT is written as DBU, how is DOG written?", options: ["EPH", "EOH", "DPH", "EPG"], answerIndex: 0, explain: "Each letter moves one step forward: D→E, O→P, G→H." },
  { text: "How many triangles are there in a square cut by both its diagonals?", options: ["4", "6", "8", "10"], answerIndex: 2, explain: "4 small triangles plus 4 made of two halves each, which is 8." },
  { text: "A clock shows 3:15. What is the angle between the hands?", options: ["0°", "7.5°", "15°", "22.5°"], answerIndex: 1, explain: "At 3:15 the minute hand is at 90° and the hour hand at 97.5°. The gap is 7.5°." },
  { text: "Pointing at a girl, Rahul says, \"She is the daughter of my mother's only son.\" Who is the girl to Rahul?", options: ["Sister", "Daughter", "Niece", "Cousin"], answerIndex: 1, explain: "My mother's only son is Rahul himself, so she is his daughter." },
];

/** A fixed set of puzzles for a seed: mostly arithmetic reasoning plus one logic question. */
export function quantSet(seed: number, count = 5): QuantQuestion[] {
  const r = rng(seed);
  const order = shuffle(r, BUILDERS.map((_, i) => i)).slice(0, count - 1);
  const list = order.map(i => BUILDERS[i](r));
  list.splice(int(r, 0, list.length), 0, pick(r, LOGIC));
  return list;
}
