// Run: npm run test:games
import assert from "node:assert/strict";
import * as L from "./ludo";
import * as W from "./wordhunt";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

// ---------------- Ludo ----------------
test("board geometry: 52 unique track squares, all inside 15x15", () => {
  assert.equal(L.TRACK.length, 52);
  assert.equal(new Set(L.TRACK.map(c => c.join(","))).size, 52);
  assert.ok(L.TRACK.every(([r, c]) => r >= 0 && r < 15 && c >= 0 && c < 15));
});
test("track is continuous (each step moves to an adjacent square)", () => {
  for (let i = 0; i < 52; i++) {
    const [r1, c1] = L.TRACK[i], [r2, c2] = L.TRACK[(i + 1) % 52];
    assert.ok(Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1, `gap between ${i} and ${i + 1}`);
  }
});
test("home columns start next to each color's last track square", () => {
  for (let color = 0; color < 4; color++) {
    const [r1, c1] = L.TRACK[L.absolute(color, L.LAST_TRACK)!], [r2, c2] = L.HOME_COLUMN[color][0];
    assert.ok(Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1, `color ${color}`);
  }
});
test("need a 6 to leave the yard; other rolls pass the turn", () => {
  let s = L.newGame([0, 2]);
  s = L.roll(s, 4);
  assert.equal(s.turn, 2); assert.equal(s.dice, null);
  s = L.roll(s, 6);
  assert.deepEqual(L.movableTokens(s), [0, 1, 2, 3]);
  s = L.move(s, 0);
  assert.equal(s.tokens[2][0], 0); assert.equal(s.turn, 2, "a 6 gives another roll");
});
test("three 6s in a row forfeits the turn", () => {
  let s = L.newGame([0, 1]);
  s = L.move(L.roll(s, 6), 0); s = L.move(L.roll(s, 6), 0);
  s = L.roll(s, 6);
  assert.equal(s.turn, 1); assert.equal(s.dice, null);
});
test("capture sends opponent home and grants another roll", () => {
  let s = L.newGame([0, 1]);
  s.tokens[0][0] = 10; // red at abs 10
  s.tokens[1][0] = 49; // green rel 49 -> abs (13+49)%52 = 10
  assert.equal(L.absolute(1, 49), 10);
  s = { ...s, turn: 0 };
  s.tokens[1][0] = 50; // green at abs 11
  s = L.move(L.roll(s, 1), 0);
  assert.equal(s.tokens[1][0], L.YARD); assert.equal(s.turn, 0);
});
test("no capture on a safe square", () => {
  let s = L.newGame([0, 1]);
  s.tokens[0][0] = 5; // red abs 5 -> moving 3 lands on 8 (star)
  s.tokens[1][0] = 47; // green abs (13+47)%52 = 8
  s = L.move(L.roll(s, 3), 0);
  assert.equal(s.tokens[1][0], 47); assert.equal(s.turn, 1);
});
test("exact roll needed to finish; overshoot not allowed", () => {
  let s = L.newGame([0, 1]);
  s.tokens[0] = [54, L.YARD, L.YARD, L.YARD];
  s = L.roll(s, 3); // 54+3 = 57 > 56 -> no move
  assert.equal(s.turn, 1);
  s = { ...s, turn: 0, dice: null };
  s = L.move(L.roll(s, 2), 0);
  assert.equal(s.tokens[0][0], L.FINISHED); assert.equal(s.turn, 0, "reaching home gives another roll");
});
test("all four home wins", () => {
  let s = L.newGame([0, 1]);
  s.tokens[0] = [56, 56, 56, 55];
  s = L.move(L.roll(s, 1), 3);
  assert.equal(s.winner, 0);
  assert.equal(L.roll(s, 6), s, "no rolling after the game ends");
});
test("computer prefers a capture", () => {
  let s = L.newGame([0, 1], [0]);
  s.tokens[0] = [10, 20, L.YARD, L.YARD];
  s.tokens[1][0] = (24 - 13 + 52) % 52; // green at abs 24
  s = L.roll(s, 4); // token1: 20->24 captures
  assert.equal(L.chooseMove(s), 1);
});
test("random full games always terminate with a winner", () => {
  for (let g = 0; g < 30; g++) {
    const rng = W.mulberry32(g + 1);
    let s = L.newGame([0, 1, 2, 3], [0, 1, 2, 3]);
    let steps = 0;
    while (s.winner == null && steps++ < 20000) {
      s = L.roll(s, 1 + Math.floor(rng() * 6));
      if (s.dice != null) s = L.move(s, L.chooseMove(s)!);
    }
    assert.notEqual(s.winner, null, `game ${g} didn't finish`);
    assert.ok(s.tokens.flat().every(r => r >= L.YARD && r <= L.FINISHED));
  }
});

// ---------------- Word Hunt ----------------
test("every word is placed and readable from the grid", () => {
  const p = W.generate(W.WORD_SETS.Family, 9, W.mulberry32(42));
  assert.equal(p.placed.length, W.WORD_SETS.Family.length);
  for (const w of p.placed) assert.equal(w.cells.map(([r, c]) => p.grid[r][c]).join(""), w.word);
});
test("grid fully filled with letters", () => {
  const p = W.generate(W.WORD_SETS.Food, 9, W.mulberry32(7));
  assert.ok(p.grid.flat().every(ch => /^[A-Z]$/.test(ch)));
});
test("line selection: straight lines only", () => {
  assert.equal(W.lineCells([0, 0], [2, 3]), null);
  assert.deepEqual(W.lineCells([0, 0], [2, 2]), [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(W.lineCells([3, 1], [3, 3]), [[3, 1], [3, 2], [3, 3]]);
});
test("finding a word works in both directions, only once", () => {
  const p = W.generate(["HELLO", "WORLD"], 8, W.mulberry32(3));
  const w = p.placed[0];
  const a = w.cells[0], b = w.cells[w.cells.length - 1];
  assert.equal(W.findWord(p, a, b)?.word, w.word);
  assert.equal(W.findWord(p, b, a)?.word, w.word);
  assert.equal(W.findWord(p, a, b, [w.word]), null);
});
test("score rewards letters and a time bonus for finishing", () => {
  const p = W.generate(["CAT", "DOG"], 6, W.mulberry32(1));
  assert.equal(W.score([p.placed[0]], 2, 10), 30);
  assert.equal(W.score(p.placed, 2, 100), 60 + 200);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
