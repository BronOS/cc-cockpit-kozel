'use strict'
// Shared test helpers: a seeded RNG, tiles by name, a stacked set that deals the hands a test wants, a round set up in
// the middle of play, and a random player for your seat.

const R = require('../lib/rules.js')

/** mulberry32: the same games every run for a seed. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `t('6-4')`: a tile by name, as written (not normalised). */
function t(name) {
  const m = /^([0-6])-([0-6])$/.exec(name)
  if (!m) throw new Error(`bad tile ${name}`)
  return { a: Number(m[1]), b: Number(m[2]) }
}
const ts = (names) => (names.trim() === '' ? [] : names.trim().split(/\s+/).map(t))
const key = (x) => R.tileName(R.norm(x))

/**
 * A 28-tile order for `rules.newRound` that deals `hands` (one string per seat, up to seven names each); every tile not
 * named fills the hands up to seven, in the set's fixed order.
 */
function stack(hands) {
  const used = new Set()
  const dealt = [0, 1, 2, 3].map((i) =>
    ts(hands[i] || '').map((x) => {
      if (used.has(key(x))) throw new Error(`tile twice: ${key(x)}`)
      used.add(key(x))
      return R.norm(x)
    }),
  )
  const rest = R.freshSet().filter((x) => !used.has(key(x)))
  for (const h of dealt) {
    if (h.length > 7) throw new Error('a hand of more than seven')
    while (h.length < 7) h.push(rest.shift())
  }
  return dealt.flat()
}

/**
 * A round in the middle of play, for a rule test: `hands` one string per seat (seat 0 you), the `chain` as written
 * (`'1-1 1-5'`, already linked), whose `turn` it is, the round's `opener`, and the public `moves` so far.
 */
function setup({ hands, chain = '', turn = 0, opener = 0, moves = [], first = false }) {
  const m = R.newMatch()
  m.first = first
  m.leader = opener
  const g = R.newRound(m, () => 0)
  g.players.forEach((p, i) => {
    p.hand = ts(hands[i] || '').map(R.norm)
  })
  g.chain = ts(chain)
  g.turn = turn
  g.opener = opener
  g.must = null
  g.moves = moves
  g.log = ''
  return { g, m }
}

/** A move for your seat, at random among the legal ones. */
function playMine(g, rng) {
  if (g.phase !== 'play' || g.turn !== R.YOU) return false
  const L = R.movesOf(g, R.YOU)
  const mv = L[Math.min(L.length - 1, Math.floor(rng() * L.length))]
  return R.play(g, R.YOU, mv.tile, mv.end)
}

module.exports = { seeded, t, ts, key, stack, setup, playMine }
