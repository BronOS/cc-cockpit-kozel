'use strict'
// The Kozel game itself (the Soviet domino game, "the goat"): a game to 101 for four players in two pairs, you and your
// partner across the table against Left and Right. The double-six set of 28 tiles, the deal of seven each, the opening
// (the 1-1 in a game's first round, then the last round's leader with any tile), the chain with its two open ends,
// playing and passing, going out, the fish (nobody can play), the scoring and the goat. Pure (no ctx, no clock, no
// DOM; `rng` injected), so `test/rules.test.js` runs every rule under node and `test/fuzz.test.js` plays whole games.
//
// The game lives in the host (lib/controller.js), one per project window; the page never sees the others' tiles until a
// round is over. What the page posts is untrusted: every move here checks what it gets, is a no-op that returns false
// when it does not apply, and says whether anything changed.
//
// A tile is `{ a, b }`, two halves 0 to 6; in a hand it is kept with `a <= b`. In the chain each tile is oriented so the
// chain reads from its start end to its far end: `chain[i].b === chain[i + 1].a`, the start end is `chain[0].a` and the
// far end `chain[last].b`. The page calls them the left and the right end (L and R); an empty chain takes a tile at S.
//
// Seats: 0 you (bottom), 1 Left, 2 your partner (top), 3 Right; play goes 0, 1, 2, 3. Teams are seats 0 and 2 (team 0,
// Us) and 1 and 3 (team 1, Them). A game `m` holds the totals and who opens next; a round `g` moves through phases:
//   play   `turn` plays a tile; a player with no tile that fits passes at once, so `turn` always has a move
//   end    the round just ended (someone went out, or a fish): it is scored on the next step, so the last tile is seen
//   done   the round is scored (`result`); the next round waits for you
//   over   the game is over: a team reached 101 (`m.winner`, and `m.goat` when the other team has 0)
//
// Scoring, as decided for this plugin (house rules differ):
//   - Going out: that player's team scores the pips left in the two opponents' hands (the partner's are not counted),
//     and that player opens the next round.
//   - Fish: the player with the fewest pips in their own hand wins the round for their team, which scores the pips in
//     both opponents' hands; that player opens next. Partners tied for the fewest are no tie (the first of them in
//     turn order from the round's opener opens). Players of the two teams tied for the fewest: nobody scores and the
//     same player opens again.

const HIGH = 6
const HAND = 7
const TARGET = 101
const SEATS = 4
const YOU = 0
const NAMES = Object.freeze(['You', 'Left', 'Partner', 'Right'])
const TEAM_NAMES = Object.freeze(['Us', 'Them'])
const TEAM_WHO = Object.freeze(['You + Partner', 'Left + Right'])
/** The tile that opens a game's first round. */
const FIRST = Object.freeze({ a: 1, b: 1 })
const ENDS = Object.freeze(['L', 'R', 'S'])
/** All the pips of the set: every number 0..6 appears on 8 halves (7 tiles, the double twice). */
const ALL_PIPS = 168

const isPip = (n) => Number.isInteger(n) && n >= 0 && n <= HIGH
const isTile = (t) => !!t && typeof t === 'object' && isPip(t.a) && isPip(t.b)
const norm = (t) => (t.a <= t.b ? { a: t.a, b: t.b } : { a: t.b, b: t.a })
const same = (x, y) => (x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a)
const isDouble = (t) => t.a === t.b
const has = (t, n) => t.a === n || t.b === n
const pips = (t) => t.a + t.b
const handPips = (h) => h.reduce((n, t) => n + pips(t), 0)
const tileName = (t) => `${t.a}-${t.b}`
const teamOf = (p) => p % 2
const nxt = (p) => (p + 1) % SEATS
const partnerOf = (p) => (p + 2) % SEATS
const opponentsOf = (p) => [(p + 1) % SEATS, (p + 3) % SEATS]
const isEnd = (e) => typeof e === 'string' && ENDS.includes(e)
/** `You pass.` / `Left passes.` */
const verb = (p, v, vs) => `${NAMES[p]} ${p === YOU ? v : vs}`

/** The 28 tiles in a fixed order (0-0, 0-1, ... 6-6). */
function freshSet() {
  const set = []
  for (let a = 0; a <= HIGH; a++) for (let b = a; b <= HIGH; b++) set.push({ a, b })
  return set
}

/** Fisher-Yates in place; `rng` returns [0, 1). */
function shuffle(tiles, rng) {
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    const t = tiles[i]
    tiles[i] = tiles[j]
    tiles[j] = t
  }
  return tiles
}

/** Whether `order` is the 28 tiles, each once (a test's stacked set). */
function isFullSet(order) {
  if (!Array.isArray(order) || order.length !== 28 || !order.every(isTile)) return false
  const seen = new Set(order.map((t) => tileName(norm(t))))
  return seen.size === 28
}

/** A new game: no points, the first round opened by the 1-1. */
function newMatch() {
  return { total: [0, 0], first: true, leader: null, rounds: 0, history: [], over: false, winner: null, goat: false }
}

/**
 * A new round of game `m`: seven tiles each from a shuffled set (or from `order`, 28 tiles, seat `i` getting
 * `order[7i .. 7i + 6]`, for tests). In the game's first round the holder of the 1-1 must open with it; later the last
 * round's leader opens with any tile.
 */
function newRound(m, rng, order) {
  if (order !== undefined && !isFullSet(order)) throw new TypeError('order must be the 28 tiles, each once')
  const tiles = order ? order.map(norm) : shuffle(freshSet(), rng)
  const players = NAMES.map((name, i) => ({ name, hand: tiles.slice(i * HAND, (i + 1) * HAND) }))
  let opener
  let must = null
  if (m.first || m.leader === null) {
    opener = players.findIndex((p) => p.hand.some((t) => same(t, FIRST)))
    must = { ...FIRST }
  } else opener = m.leader
  const g = {
    players,
    chain: [],
    turn: opener,
    opener,
    must,
    phase: 'play',
    /** Every move so far, public: `{ p, tile, end }` or `{ p, pass: true, ends: [l, r] }`. */
    moves: [],
    ending: null,
    result: null,
    log: '',
  }
  g.log = must ? `${NAMES[opener]} ${opener === YOU ? 'hold' : 'holds'} the 1-1 and ${opener === YOU ? 'open' : 'opens'}.` : `${verb(opener, 'open', 'opens')}.`
  return g
}

/** The two open ends `{ l, r }`, or null while the chain is empty. */
function endsOf(g) {
  if (g.chain.length === 0) return null
  return { l: g.chain[0].a, r: g.chain[g.chain.length - 1].b }
}

/**
 * Seat `p`'s legal moves `[{ tile, end }]`: on an empty chain any tile at S (only the 1-1 in a game's first round),
 * else each tile on each end one of its halves matches. A tile that fits both ends is listed twice.
 */
function movesOf(g, p) {
  const hand = g.players[p].hand
  const e = endsOf(g)
  const out = []
  for (const tile of hand) {
    if (!e) {
      if (!g.must || same(tile, g.must)) out.push({ tile, end: 'S' })
      continue
    }
    if (has(tile, e.l)) out.push({ tile, end: 'L' })
    if (has(tile, e.r)) out.push({ tile, end: 'R' })
  }
  return out
}

const canMove = (g, p) => movesOf(g, p).length > 0

/** Puts `tile` on `end`, turned so its matching half meets the end. Assumes the move is legal. */
function place(g, tile, end) {
  if (end === 'S') {
    g.chain.push({ a: tile.a, b: tile.b })
    return
  }
  const e = endsOf(g)
  if (end === 'L') {
    g.chain.unshift(tile.b === e.l ? { a: tile.a, b: tile.b } : { a: tile.b, b: tile.a })
  } else {
    g.chain.push(tile.a === e.r ? { a: tile.a, b: tile.b } : { a: tile.b, b: tile.a })
  }
}

/** The turn after `from`: everyone who cannot play passes (logged, with the ends they passed on), or a fish. */
function advance(g, from) {
  if (![0, 1, 2, 3].some((q) => canMove(g, q))) {
    g.phase = 'end'
    g.ending = { kind: 'fish', p: null }
    g.log += ' Fish: nobody can play.'
    return
  }
  let q = nxt(from)
  while (!canMove(g, q)) {
    const e = endsOf(g)
    g.moves.push({ p: q, pass: true, ends: [e.l, e.r] })
    g.log += ` ${verb(q, 'pass', 'passes')}.`
    q = nxt(q)
  }
  g.turn = q
}

/**
 * Seat `p` plays `tile` on `end` (`'L'`, `'R'`, or `'S'` on an empty chain). Only on `p`'s turn and only a legal move;
 * returns whether it was played. The last tile of a hand ends the round (`end` phase, scored by `score`).
 */
function play(g, p, tile, end) {
  if (g.phase !== 'play' || g.turn !== p || !isTile(tile) || !isEnd(end)) return false
  const t = norm(tile)
  const hand = g.players[p].hand
  const i = hand.findIndex((x) => same(x, t))
  if (i < 0) return false
  if (!movesOf(g, p).some((x) => same(x.tile, t) && x.end === end)) return false
  hand.splice(i, 1)
  place(g, t, end)
  g.must = null
  g.moves.push({ p, tile: t, end })
  g.log = `${NAMES[p]} played ${tileName(t)}.`
  if (hand.length === 0) {
    g.phase = 'end'
    g.ending = { kind: 'out', p }
    g.log += ` ${verb(p, 'go', 'goes')} out!`
    return true
  }
  advance(g, p)
  return true
}

/**
 * Scores a round that ended (`end` phase): the points to a team, who opens next, the game's end and the goat. Returns
 * whether it scored (false outside the `end` phase).
 */
function score(g, m) {
  if (g.phase !== 'end' || !g.ending) return false
  const sums = g.players.map((p) => handPips(p.hand))
  const result = { kind: g.ending.kind, by: g.ending.p, team: null, points: 0, tie: false, sums, low: null, tied: [] }
  let leader
  if (g.ending.kind === 'out') {
    const p = g.ending.p
    result.team = teamOf(p)
    result.points = opponentsOf(p).reduce((n, q) => n + sums[q], 0)
    leader = p
  } else {
    const low = Math.min(...sums)
    result.low = low
    const order = [0, 1, 2, 3].map((k) => (g.opener + k) % SEATS)
    const lows = order.filter((q) => sums[q] === low)
    if (new Set(lows.map(teamOf)).size > 1) {
      result.tie = true
      result.tied = lows
      leader = g.opener
    } else {
      const p = lows[0]
      result.by = p
      result.team = teamOf(p)
      result.points = opponentsOf(p).reduce((n, q) => n + sums[q], 0)
      leader = p
    }
  }
  if (result.team !== null) m.total[result.team] += result.points
  m.first = false
  m.leader = leader
  m.rounds++
  m.history.push({ kind: result.kind, by: result.by, team: result.team, points: result.points, tie: result.tie, total: m.total.slice() })
  g.result = result
  if (result.team !== null && m.total[result.team] >= TARGET) {
    m.over = true
    m.winner = result.team
    m.goat = m.total[1 - result.team] === 0
    g.phase = 'over'
  } else g.phase = 'done'
  return true
}

/** Every tile is somewhere: the four hands and the chain hold the 28 tiles, each once. */
function tileCount(g) {
  const all = [...g.players.flatMap((p) => p.hand), ...g.chain].map((t) => tileName(norm(t)))
  return new Set(all).size === all.length ? all.length : -1
}

/** A hand as you see it, high to low from the left: the most pips first, then the higher half; each shown high half first. */
function sortedHand(hand) {
  return hand
    .map((t) => ({ a: Math.max(t.a, t.b), b: Math.min(t.a, t.b) }))
    .sort((x, y) => pips(y) - pips(x) || y.a - x.a)
}

module.exports = {
  HIGH,
  HAND,
  TARGET,
  SEATS,
  YOU,
  NAMES,
  TEAM_NAMES,
  TEAM_WHO,
  FIRST,
  ENDS,
  ALL_PIPS,
  isPip,
  isTile,
  isEnd,
  norm,
  same,
  isDouble,
  has,
  pips,
  handPips,
  tileName,
  teamOf,
  nxt,
  partnerOf,
  opponentsOf,
  freshSet,
  shuffle,
  isFullSet,
  newMatch,
  newRound,
  endsOf,
  movesOf,
  canMove,
  play,
  score,
  tileCount,
  sortedHand,
}
