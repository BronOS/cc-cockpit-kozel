'use strict'
// Many whole games, seeded: your seat played at random, the computer players by lib/bots.js. After every step: the 28
// tiles are all there once (the hands and the chain), the chain's neighbours meet half to half, the player in turn has
// a legal move, and every tile played was legal for its player at that moment. Every round scores what its rule says
// (the opponents' pips, or nothing on a tied fish), the totals never go down, nothing gets stuck, and every game ends
// with a team at 101 or more (the goat exactly when the other team has 0).
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const B = require('../lib/bots.js')
const { seeded, key, playMine } = require('./helpers.js')

const GAMES = Number(process.env.FUZZ_GAMES) || 400
const MAX_STEPS = 20000

function check(g, where) {
  assert.equal(R.tileCount(g), 28, `${where}: 28 tiles, each once`)
  for (let i = 0; i + 1 < g.chain.length; i++) assert.equal(g.chain[i].b, g.chain[i + 1].a, `${where}: link ${i}`)
  for (const p of g.players) assert.ok(p.hand.length <= 7, `${where}: a hand of ${p.hand.length}`)
  if (g.phase === 'play') {
    assert.ok(g.turn >= 0 && g.turn < 4, `${where}: whose turn`)
    assert.ok(R.canMove(g, g.turn), `${where}: the player in turn has no move`)
  }
}

/** One game; `bot(seat)` says whether a seat is a computer player (else it plays at random). */
function playGame(seed, bot = (p) => p !== R.YOU) {
  const rng = seeded(seed)
  const m = R.newMatch()
  let g = R.newRound(m, rng)
  check(g, `seed ${seed} deal`)
  let steps = 0
  let rounds = 0
  let fish = 0
  let ties = 0
  let last = [0, 0]
  while (!m.over && steps < MAX_STEPS) {
    steps++
    const where = `seed ${seed} step ${steps} (${g.phase})`
    let moved
    if (g.phase === 'end') {
      moved = R.score(g, m)
      rounds++
      const r = g.result
      if (r.kind === 'fish') fish++
      if (r.tie) {
        ties++
        assert.equal(r.points, 0)
        assert.deepEqual(m.total, last, `${where}: a tie scores nothing`)
      } else {
        const opp = R.opponentsOf(r.by)
        assert.equal(r.points, r.sums[opp[0]] + r.sums[opp[1]], `${where}: the opponents' pips`)
        if (r.kind === 'fish') assert.equal(r.sums[r.by], Math.min(...r.sums), `${where}: the fewest pips win the fish`)
        else assert.equal(r.sums[r.by], 0, `${where}: went out with nothing`)
      }
      assert.ok(m.total[0] >= last[0] && m.total[1] >= last[1], `${where}: totals never go down`)
      last = m.total.slice()
      if (!m.over) {
        assert.equal(g.phase, 'done')
        g = R.newRound(m, rng)
        assert.equal(g.turn, m.leader, `${where}: the leader opens`)
      }
    } else if (!bot(g.turn)) {
      const before = R.movesOf(g, g.turn).map((x) => `${key(x.tile)}${x.end}`)
      const n = g.moves.length
      if (g.turn === R.YOU) moved = playMine(g, rng)
      else {
        const L = R.movesOf(g, g.turn)
        const mv = L[Math.min(L.length - 1, Math.floor(rng() * L.length))]
        moved = R.play(g, g.turn, mv.tile, mv.end)
      }
      const mv = g.moves[n]
      assert.ok(before.includes(`${key(mv.tile)}${mv.end}`), `${where}: your tile was legal`)
    } else {
      const k = B.knowledge(g, g.turn)
      const move = B.decide(k, rng)
      assert.ok(move, `${where}: no move for seat ${g.turn}`)
      const legal = R.movesOf(g, g.turn).map((x) => `${key(x.tile)}${x.end}`)
      assert.ok(legal.includes(`${key(move.tile)}${move.end}`), `${where}: ${g.players[g.turn].name}'s tile was legal`)
      moved = R.play(g, g.turn, move.tile, move.end)
    }
    assert.ok(moved, `${where}: nobody could move (turn ${g.turn})`)
    check(g, where)
  }
  assert.ok(m.over, `seed ${seed}: the game never ended`)
  assert.equal(g.phase, 'over')
  assert.ok(m.total[m.winner] >= R.TARGET, `seed ${seed}: over before 101`)
  assert.ok(m.total[1 - m.winner] < R.TARGET, `seed ${seed}: the loser under 101`)
  assert.equal(m.goat, m.total[1 - m.winner] === 0)
  assert.equal(m.history.length, rounds)
  return { winner: m.winner, rounds, fish, ties, goat: m.goat }
}

test(`${GAMES} games, your seat at random: invariants hold, rounds score by the rule, every game ends`, () => {
  const tally = { won: 0, lost: 0, rounds: 0, fish: 0, ties: 0, goats: 0 }
  for (let k = 0; k < GAMES; k++) {
    const r = playGame(1000 + k)
    tally[r.winner === 0 ? 'won' : 'lost']++
    tally.rounds += r.rounds
    tally.fish += r.fish
    tally.ties += r.ties
    if (r.goat) tally.goats++
  }
  // Every kind of end happens.
  assert.ok(tally.won > 0, 'you sometimes win')
  assert.ok(tally.lost > 0, 'you sometimes lose')
  assert.ok(tally.fish > 0, 'fish happen')
  assert.ok(tally.ties > 0, 'tied fish happen')
  assert.ok(tally.goats > 0, 'goats happen')
  assert.ok(tally.rounds > tally.fish, 'most rounds end by going out')
})

test('the computer players play better than chance: a team of them beats a team playing at random', () => {
  let bots = 0
  const n = Math.max(200, Math.floor(GAMES / 2))
  for (let k = 0; k < n; k++) {
    // Seats 1 and 3 are computer players, 0 and 2 play at random.
    const r = playGame(50000 + k, (p) => p % 2 === 1)
    if (r.winner === 1) bots++
  }
  assert.ok(bots / n > 0.6, `the computer players won ${bots} of ${n}`)
})
