'use strict'
// The computer players' choices: one move for the seat whose turn it is. Pure (`rng` injected, used only to break
// ties); lib/controller.js applies the move through the same rules (lib/rules.js) your own moves go through, on a timer
// in the host, so you see each one.
//
// A computer player decides from what it could know at a real table, never from another hand: `knowledge(g, p)`
// copies its own hand, the chain, how many tiles each player holds and the public moves (who played what, who passed
// on which ends), and `decide` sees only that. From it, it works out:
//   - each player's known voids: a player who passed on ends 3 and 5 holds no 3 and no 5 (hands only shrink, so it
//     stays true), and a number whose every tile is in the chain or in its own hand is a void for all the others;
//   - the pips the others hold between them (the set's 168 less the chain and its own hand).
// Each legal move gets a score, the best is played:
//   - going out wins outright;
//   - heavy tiles first (the pips stay in hand if the round ends), doubles earlier still (they fit one number only), more
//     so when an opponent is close to going out;
//   - keeping moves for later: tiles left that fit the new ends, best on both ends;
//   - leaving ends the next opponent is known to be void in (it must pass), and not ones that block its partner;
//   - a move that surely blocks everyone (a fish) is sought when its own pips are well under what the opponents are
//     likely to hold, and avoided when they are not.

const R = require('./rules.js')

/** What seat `p` may know: its own hand and the public table. Nothing of another hand but its size. */
function knowledge(g, p) {
  return {
    seat: p,
    hand: g.players[p].hand.map((t) => ({ a: t.a, b: t.b })),
    chain: g.chain.map((t) => ({ a: t.a, b: t.b })),
    must: g.must ? { ...g.must } : null,
    counts: g.players.map((x) => x.hand.length),
    moves: g.moves.map((x) => (x.pass ? { p: x.p, pass: true, ends: x.ends.slice() } : { p: x.p, tile: { ...x.tile }, end: x.end })),
  }
}

/** The legal moves from `k` alone (the same rule as rules.movesOf). */
function movesFrom(k) {
  const out = []
  if (k.chain.length === 0) {
    for (const tile of k.hand) if (!k.must || R.same(tile, k.must)) out.push({ tile, end: 'S' })
    return out
  }
  const l = k.chain[0].a
  const r = k.chain[k.chain.length - 1].b
  for (const tile of k.hand) {
    if (R.has(tile, l)) out.push({ tile, end: 'L' })
    if (R.has(tile, r)) out.push({ tile, end: 'R' })
  }
  return out
}

/** The ends after `tile` goes on `end`. */
function endsAfter(k, tile, end) {
  if (end === 'S') return { l: tile.a, r: tile.b }
  const l = k.chain[0].a
  const r = k.chain[k.chain.length - 1].b
  const other = (n) => (tile.a === n ? tile.b : tile.a)
  return end === 'L' ? { l: other(l), r } : { l, r: other(r) }
}

/** Per seat, the numbers it is known not to hold (from its passes). */
function voidsOf(k) {
  const v = [new Set(), new Set(), new Set(), new Set()]
  for (const x of k.moves) if (x.pass) for (const n of x.ends) v[x.p].add(n)
  return v
}

/** How many tiles with `n` are neither in the chain nor in `hand` (so somewhere in the others' hands). */
function unseenWith(k, hand, n) {
  let seen = 0
  for (const t of k.chain) if (R.has(t, n)) seen++
  for (const t of hand) if (R.has(t, n)) seen++
  return R.HIGH + 1 - seen
}

/** The score of one move for the player of `k`; higher is better. */
function scoreMove(k, move) {
  const me = k.seat
  const t = move.tile
  const rest = k.hand.filter((x) => !R.same(x, t))
  if (rest.length === 0) return 1e6
  const e = endsAfter(k, t, move.end)
  const voids = voidsOf(k)
  const partner = R.partnerOf(me)
  const [next, prev] = R.opponentsOf(me)
  // A number nobody else holds: every tile with it is in the chain (after this move) or still in my hand.
  const after = { chain: [...k.chain, t] }
  const gone = (n) => unseenWith(after, rest, n) === 0
  const voidIn = (q, n) => voids[q].has(n) || gone(n)
  const blocked = (q) => voidIn(q, e.l) && voidIn(q, e.r)
  const danger = Math.min(k.counts[next], k.counts[prev]) <= 2

  let s = 0
  // Heavy tiles out first; doubles before that, while the hand is big.
  s += R.pips(t) * (danger ? 1.6 : 1)
  if (R.isDouble(t)) s += 3 + rest.length
  // Keep moves for the next turn, best on both ends.
  const fitL = rest.filter((x) => R.has(x, e.l)).length
  const fitR = rest.filter((x) => R.has(x, e.r)).length
  const fit = rest.filter((x) => R.has(x, e.l) || R.has(x, e.r)).length
  s += 2.5 * Math.min(fit, 3)
  if (fitL > 0) s += 2
  if (fitR > 0) s += 2
  if (fit === 0) s -= 6

  // The next opponent made to pass; the partner not.
  if (blocked(next)) s += 8 * (k.counts[next] <= 2 ? 2 : 1)
  if (blocked(prev)) s += 3
  if (blocked(partner)) s -= 7 * (k.counts[partner] <= 2 ? 1.5 : 1)

  // A sure fish: every other player is void in both ends and nothing in my hand fits.
  if (fit === 0 && blocked(next) && blocked(prev) && blocked(partner)) {
    const othersPips = R.ALL_PIPS - k.chain.reduce((n, x) => n + R.pips(x), 0) - R.handPips(k.hand)
    const othersTiles = k.counts.reduce((n, c, q) => (q === me ? n : n + c), 0)
    const per = othersTiles > 0 ? othersPips / othersTiles : 0
    const mine = R.handPips(rest)
    const oppLow = Math.min(k.counts[next], k.counts[prev]) * per
    const oppAll = (k.counts[next] + k.counts[prev]) * per
    if (mine < 0.8 * oppLow) s += 30 + 0.3 * oppAll
    else if (mine > 1.2 * oppLow) s -= 30
    else s -= 5
  }
  return s
}

/** The best move from `k`, ties broken by `rng`; null when there is none. */
function decide(k, rng = Math.random) {
  const moves = movesFrom(k)
  if (moves.length === 0) return null
  let best = null
  let bs = -Infinity
  for (const m of moves) {
    const s = scoreMove(k, m) + rng() * 0.01
    if (s > bs) {
      bs = s
      best = m
    }
  }
  return { tile: { a: best.tile.a, b: best.tile.b }, end: best.end }
}

/** The move of the computer player whose turn it is, or null when it is your turn or no round is in play. */
function choose(g, rng = Math.random) {
  if (g.phase !== 'play' || g.turn < 1 || g.turn >= R.SEATS) return null
  return decide(knowledge(g, g.turn), rng)
}

/** Plays a move `choose` gave for the seat in turn; returns whether the round changed. */
function apply(g, move) {
  if (!move) return false
  return R.play(g, g.turn, move.tile, move.end)
}

module.exports = { knowledge, movesFrom, endsAfter, voidsOf, unseenWith, scoreMove, decide, choose, apply }
