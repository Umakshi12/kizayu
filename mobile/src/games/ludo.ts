// Ludo rules engine (pure, no React). Traditional rules:
// - roll a 6 to bring a token out; a 6 gives another roll; three 6s in a row forfeits the turn
// - landing on an opponent outside a safe square sends it back to its yard and gives another roll
// - tokens go once around the 52-square track, up their 5-square home column, and need an exact roll to finish
// - reaching home gives another roll; first player with all 4 tokens home wins

export const COLORS = ["#E5484D", "#2F9E6B", "#E8A500", "#1E9BF0"] as const;
export const NAMES = ["Red", "Green", "Yellow", "Blue"] as const;
export const START = [0, 13, 26, 39] as const; // absolute track index where each color enters
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // start squares + stars
export const LAST_TRACK = 50; // relative 0..50 = main track
export const FINISHED = 56; // relative 51..55 = home column, 56 = home
export const YARD = -1;

export type Cell = readonly [row: number, col: number];

export interface LudoState {
  players: number[]; // colors in play, in turn order
  computer: number[]; // colors played by the computer
  tokens: number[][]; // tokens[color][i] = relative position (YARD, 0..56)
  turn: number; // color whose turn it is
  dice: number | null; // rolled, waiting for a move
  sixes: number; // consecutive sixes this turn
  winner: number | null;
  log: string;
}

export function newGame(players: number[], computer: number[] = []): LudoState {
  if (players.length < 2 || players.length > 4) throw new Error("Ludo needs 2-4 players");
  return {
    players: [...players], computer: [...computer],
    tokens: [0, 1, 2, 3].map(() => [YARD, YARD, YARD, YARD]),
    turn: players[0], dice: null, sixes: 0, winner: null, log: `${NAMES[players[0]]} to roll`,
  };
}

/** Absolute track square for a relative position, or null if in yard / home column / home. */
export function absolute(color: number, rel: number): number | null {
  return rel >= 0 && rel <= LAST_TRACK ? (START[color] + rel) % 52 : null;
}

export function canMove(rel: number, dice: number): boolean {
  if (rel === YARD) return dice === 6;
  return rel !== FINISHED && rel + dice <= FINISHED;
}

export function movableTokens(s: LudoState, dice = s.dice): number[] {
  if (dice == null || s.winner != null) return [];
  return s.tokens[s.turn].map((rel, i) => (canMove(rel, dice) ? i : -1)).filter(i => i >= 0);
}

const nextPlayer = (s: LudoState) => s.players[(s.players.indexOf(s.turn) + 1) % s.players.length];
const clone = (s: LudoState): LudoState => ({ ...s, tokens: s.tokens.map(t => [...t]) });

/** Roll the dice. If no move is possible (or three 6s), the turn passes automatically. */
export function roll(state: LudoState, value: number): LudoState {
  if (state.winner != null || state.dice != null) return state;
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error("Dice value must be 1-6");
  const s = clone(state);
  s.sixes = value === 6 ? s.sixes + 1 : 0;
  if (s.sixes === 3) {
    const who = NAMES[s.turn];
    s.turn = nextPlayer(s); s.sixes = 0; s.dice = null;
    s.log = `${who} rolled three 6s and loses the turn. ${NAMES[s.turn]} to roll`;
    return s;
  }
  s.dice = value;
  if (!movableTokens(s).length) {
    const who = NAMES[s.turn];
    s.turn = value === 6 ? s.turn : nextPlayer(s); // no possible move on a 6 still keeps the bonus roll
    if (value !== 6) s.sixes = 0;
    s.dice = null;
    s.log = `${who} rolled ${value}, no move. ${NAMES[s.turn]} to roll`;
    return s;
  }
  s.log = `${NAMES[s.turn]} rolled ${value}. Pick a token`;
  return s;
}

/** Move one of the current player's tokens by the rolled amount. */
export function move(state: LudoState, tokenIdx: number): LudoState {
  const dice = state.dice;
  if (dice == null || !movableTokens(state).includes(tokenIdx)) return state;
  const s = clone(state);
  const me = s.turn;
  const from = s.tokens[me][tokenIdx];
  const to = from === YARD ? 0 : from + dice;
  s.tokens[me][tokenIdx] = to;

  let captured = 0;
  const abs = absolute(me, to);
  if (abs != null && !SAFE.has(abs)) {
    for (const other of s.players) {
      if (other === me) continue;
      s.tokens[other] = s.tokens[other].map(rel => {
        if (absolute(other, rel) === abs) { captured++; return YARD; }
        return rel;
      });
    }
  }
  const reachedHome = to === FINISHED;
  s.dice = null;

  if (s.tokens[me].every(r => r === FINISHED)) {
    s.winner = me;
    s.log = `${NAMES[me]} wins! 🎉`;
    return s;
  }
  const bonus = dice === 6 || captured > 0 || reachedHome;
  const what = captured ? `captured ${captured} token${captured > 1 ? "s" : ""}!` : reachedHome ? "got a token home!" : from === YARD ? "brought a token out" : `moved ${dice}`;
  if (!bonus) { s.turn = nextPlayer(s); s.sixes = 0; }
  s.log = `${NAMES[me]} ${what}${bonus ? " Roll again" : ""}. ${bonus ? "" : `${NAMES[s.turn]} to roll`}`.trim();
  return s;
}

/** Computer strategy: capture > finish > leave yard > reach safety > escape danger > advance furthest. */
export function chooseMove(s: LudoState): number | null {
  const options = movableTokens(s);
  if (!options.length || s.dice == null) return null;
  const me = s.turn, dice = s.dice;
  const opponentsAt = (abs: number) => s.players.filter(p => p !== me).some(p => s.tokens[p].some(r => absolute(p, r) === abs));
  const threatened = (abs: number | null) => abs != null && !SAFE.has(abs) &&
    s.players.filter(p => p !== me).some(p => s.tokens[p].some(r => {
      const a = absolute(p, r);
      return a != null && ((abs - a + 52) % 52) >= 1 && ((abs - a + 52) % 52) <= 6;
    }));
  let best = options[0], bestScore = -Infinity;
  for (const i of options) {
    const from = s.tokens[me][i], to = from === YARD ? 0 : from + dice;
    const abs = absolute(me, to);
    let score = to; // progress
    if (abs != null && !SAFE.has(abs) && opponentsAt(abs)) score += 100;
    if (to === FINISHED) score += 80;
    if (from === YARD) score += 60;
    if (abs != null && SAFE.has(abs)) score += 25;
    if (to > LAST_TRACK) score += 20; // into home column = safe forever
    if (threatened(absolute(me, from))) score += 15;
    if (threatened(abs)) score -= 30;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ---------- Board geometry (15x15 grid) ----------
// Main track, clockwise, starting at Red's entry square.
export const TRACK: Cell[] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
];
export const HOME_COLUMN: Cell[][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];
export const YARD_CELLS: Cell[][] = [
  [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],
  [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],
  [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],
  [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],
];
export const HOME_CELL: Cell[] = [[7, 6], [6, 7], [7, 8], [8, 7]]; // finished tokens sit next to the center

export function tokenCell(color: number, idx: number, rel: number): Cell {
  if (rel === YARD) return YARD_CELLS[color][idx];
  if (rel <= LAST_TRACK) return TRACK[absolute(color, rel)!];
  if (rel < FINISHED) return HOME_COLUMN[color][rel - LAST_TRACK - 1];
  return HOME_CELL[color];
}
