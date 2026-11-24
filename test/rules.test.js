'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const { t, ts, key, stack, setup } = require('./helpers.js')

const names = (tiles) => tiles.map(key).sort()
const ends = (g) => R.endsOf(g)

test('the set: 28 tiles of the double-six set, 168 pips, every number on seven tiles', () => {
  const set = R.freshSet()
  assert.equal(set.length, 28)
  assert.equal(new Set(set.map(key)).size, 28)
  assert.equal(set.reduce((n, x) => n + R.pips(x), 0), R.ALL_PIPS)
  for (let n = 0; n <= 6; n++) assert.equal(set.filter((x) => R.has(x, n)).length, 7, `number ${n}`)
  assert.equal(set.filter(R.isDouble).length, 7)
})

test('a deal: seven each; in the first round the holder of the 1-1 opens and only the 1-1 may go', () => {
  const m = R.newMatch()
  const g = R.newRound(m, () => 0, stack(['6-6', '', '1-1 5-5']))
  for (const p of g.players) assert.equal(p.hand.length, 7)
  assert.equal(R.tileCount(g), 28)
  assert.equal(g.turn, 2)
  assert.equal(g.opener, 2)
  assert.deepEqual(R.movesOf(g, 2), [{ tile: { a: 1, b: 1 }, end: 'S' }])
  assert.equal(R.play(g, 2, t('5-5'), 'S'), false, 'not the 1-1')
  assert.equal(g.log, 'Partner holds the 1-1 and opens.')
  assert.equal(R.play(g, 2, t('1-1'), 'S'), true)
  assert.deepEqual(g.chain, [{ a: 1, b: 1 }])
  assert.equal(g.must, null)
  const mine = R.newRound(R.newMatch(), () => 0, stack(['1-1']))
  assert.equal(mine.log, 'You hold the 1-1 and open.')
})

test('later rounds: the last round’s leader opens with any tile', () => {
  const m = R.newMatch()
  m.first = false
  m.leader = 3
  const g = R.newRound(m, () => 0, stack(['1-1', '', '', '6-6 0-0']))
  assert.equal(g.turn, 3)
  assert.equal(g.must, null)
  assert.equal(R.movesOf(g, 3).length, 7, 'every tile at S')
  assert.equal(g.log, 'Right opens.')
  assert.equal(R.play(g, 3, t('0-0'), 'S'), true)
})

test('legal moves: a half matching an end; a tile fitting both ends is listed for each; none when nothing fits', () => {
  const { g } = setup({ hands: ['3-5 2-6 4-4 0-1'], chain: '3-1 1-5' })
  assert.deepEqual(ends(g), { l: 3, r: 5 })
  assert.deepEqual(
    R.movesOf(g, 0).map((x) => `${key(x.tile)}${x.end}`),
    ['3-5L', '3-5R'],
  )
  const { g: g2 } = setup({ hands: ['2-6 4-4'], chain: '3-1 1-5' })
  assert.deepEqual(R.movesOf(g2, 0), [])
  assert.equal(R.canMove(g2, 0), false)
})

test('placing: each tile turned so it meets its end; the chain reads start to far end, links matching', () => {
  const { g } = setup({ hands: ['5-2 3-6 2-2', '', '', ''], chain: '3-1 1-5' })
  g.players[1].hand = [t('6-6')]
  assert.equal(R.play(g, 0, t('5-2'), 'R'), true)
  assert.deepEqual(g.chain.at(-1), { a: 5, b: 2 })
  g.turn = 0
  assert.equal(R.play(g, 0, t('6-3'), 'L'), true, 'given either way round')
  assert.deepEqual(g.chain[0], { a: 6, b: 3 })
  g.turn = 0
  assert.equal(R.play(g, 0, t('2-2'), 'R'), true)
  assert.deepEqual(ends(g), { l: 6, r: 2 })
  for (let i = 0; i + 1 < g.chain.length; i++) assert.equal(g.chain[i].b, g.chain[i + 1].a, `link ${i}`)
  assert.deepEqual(g.moves.filter((x) => !x.pass).map((x) => x.end), ['R', 'L', 'R'])
})

test('a move is refused off turn, off the ends, for a tile not held, for junk', () => {
  const { g } = setup({ hands: ['3-5 2-6', '5-6 0-0', '1-2', '4-4'], chain: '3-1 1-5' })
  const before = JSON.stringify(g)
  assert.equal(R.play(g, 1, t('5-6'), 'R'), false, 'not your turn')
  assert.equal(R.play(g, 0, t('2-6'), 'R'), false, 'does not fit')
  assert.equal(R.play(g, 0, t('3-5'), 'S'), false, 'S only on an empty chain')
  assert.equal(R.play(g, 0, t('5-6'), 'R'), false, 'not in your hand')
  for (const junk of [null, {}, { a: 7, b: 1 }, { a: '3', b: 5 }, { a: 3.5, b: 5 }]) assert.equal(R.play(g, 0, junk, 'R'), false)
  for (const end of [undefined, 'X', '__proto__', 'l', 0]) assert.equal(R.play(g, 0, t('3-5'), end), false)
  assert.equal(JSON.stringify(g), before, 'nothing changed')
  g.phase = 'done'
  assert.equal(R.play(g, 0, t('3-5'), 'R'), false, 'not in play')
})

test('passing: a player with nothing that fits passes at once, with the ends it passed on; the turn goes on', () => {
  const { g } = setup({ hands: ['5-6 0-0', '1-2 3-3', '2-4 4-4', '6-2 0-1'], chain: '3-1 1-5' })
  assert.equal(R.play(g, 0, t('5-6'), 'R'), true)
  assert.deepEqual(ends(g), { l: 3, r: 6 })
  // Left holds 3-3: it plays. Nobody passes yet.
  assert.equal(g.turn, 1)
  assert.equal(R.play(g, 1, t('3-3'), 'L'), true)
  // Partner holds no 3 and no 6: passes. Right has 6-2.
  assert.equal(g.turn, 3)
  assert.deepEqual(g.moves.at(-1), { p: 2, pass: true, ends: [3, 6] })
  assert.equal(g.log, 'Left played 3-3. Partner passes.')
  assert.equal(R.play(g, 3, t('6-2'), 'R'), true)
  // You hold 0-0 only: you pass; Left has 1-2.
  assert.equal(g.turn, 1)
  assert.match(g.log, /You pass\./)
})

test('going out: that team scores the two opponents’ pips, not the partner’s; that player opens next', () => {
  const { g, m } = setup({ hands: ['3-5', '6-6 1-2', '5-5 4-4', '0-2 0-0'], chain: '3-1 1-5', opener: 1 })
  assert.equal(R.play(g, 0, t('5-3'), 'R'), true)
  assert.equal(g.phase, 'end')
  assert.deepEqual(g.ending, { kind: 'out', p: 0 })
  assert.equal(g.log, 'You played 3-5. You go out!')
  assert.equal(R.score(g, m), true)
  assert.equal(g.phase, 'done')
  assert.equal(g.result.team, 0)
  assert.equal(g.result.points, 15 + 2, 'Left 15, Right 2; Partner’s 18 not counted')
  assert.deepEqual(m.total, [17, 0])
  assert.equal(m.leader, 0)
  assert.equal(m.first, false)
  assert.equal(R.score(g, m), false, 'scored once')
  const next = R.newRound(m, () => 0)
  assert.equal(next.turn, 0)
  assert.equal(next.must, null)
})

test('fish: when nobody can play, the fewest pips in one hand wins for that team; it scores the opponents’ pips', () => {
  // Ends 6 and 6 after Left plays 6-6 ... set up so every 6 and 5 is gone.
  const { g, m } = setup({
    hands: ['0-1 0-2', '5-6 3-3', '0-0 1-1', '2-2 4-4'],
    chain: '6-0 0-3 3-6 6-1 1-6 6-2 2-6 6-4 4-5 5-0 0-5 5-1 1-5 5-2 2-5 5-3 3-5 5-4 4-6',
    turn: 1,
    opener: 3,
  })
  // Hands are only for the test; tile conservation does not matter here.
  assert.deepEqual(ends(g), { l: 6, r: 6 })
  assert.equal(R.play(g, 1, t('6-5'), 'R'), true)
  assert.equal(g.phase, 'end')
  assert.equal(g.ending.kind, 'fish')
  assert.match(g.log, /Fish: nobody can play\./)
  R.score(g, m)
  assert.deepEqual(g.result.sums, [3, 6, 2, 12])
  assert.equal(g.result.by, 2, 'Partner holds the fewest (2)')
  assert.equal(g.result.team, 0)
  assert.equal(g.result.points, 6 + 12, 'Left’s and Right’s pips')
  assert.equal(m.leader, 2)
})

test('fish: partners tied for the fewest are no tie; the first of them in turn order from the opener', () => {
  const { g, m } = setup({ hands: ['1-2', '6-6', '0-3', '5-5'], chain: '4-4', turn: 0, opener: 1 })
  g.phase = 'end'
  g.ending = { kind: 'fish', p: null }
  R.score(g, m)
  assert.equal(g.result.tie, false)
  assert.equal(g.result.by, 2, 'from Left (the opener): Partner comes before you')
  assert.equal(g.result.points, 22)
  assert.equal(m.leader, 2)
})

test('fish: players of both teams tied for the fewest: nobody scores and the same player opens again', () => {
  const { g, m } = setup({ hands: ['1-2', '0-3', '6-6', '5-5'], chain: '4-4', opener: 3 })
  m.total = [10, 20]
  g.phase = 'end'
  g.ending = { kind: 'fish', p: null }
  R.score(g, m)
  assert.equal(g.result.tie, true)
  assert.deepEqual(g.result.tied, [0, 1])
  assert.equal(g.result.team, null)
  assert.equal(g.result.points, 0)
  assert.deepEqual(m.total, [10, 20])
  assert.equal(m.leader, 3, 'the opener again')
  assert.equal(R.newRound(m, () => 0).turn, 3)
})

test('the game ends when a team reaches 101; the goat when the other has nothing', () => {
  const play = (total, team) => {
    const { g, m } = setup({ hands: team === 0 ? ['', '6-6 5-5', '1-1', '4-4 3-3'] : ['6-6 5-5', '', '4-4 3-3', '1-1'], chain: '0-0' })
    m.total = total.slice()
    g.phase = 'end'
    g.ending = { kind: 'out', p: team }
    R.score(g, m)
    return { g, m }
  }
  let { g, m } = play([70, 0], 0)
  assert.equal(g.result.points, 36)
  assert.equal(g.phase, 'over')
  assert.equal(m.over, true)
  assert.equal(m.winner, 0)
  assert.equal(m.goat, true, 'Them at 0: the goat')
  ;({ g, m } = play([70, 5], 0))
  assert.equal(m.over, true)
  assert.equal(m.goat, false)
  ;({ g, m } = play([0, 100], 1))
  assert.equal(m.winner, 1)
  assert.equal(m.goat, true, 'you are the goat')
  ;({ g, m } = play([0, 40], 1))
  assert.equal(m.over, false, '40 + 36 = 76')
  assert.equal(g.phase, 'done')
})

test('exactly 101 ends it too', () => {
  const { g, m } = setup({ hands: ['', '6-6', '1-1', '0-1'], chain: '0-0' })
  m.total = [88, 3]
  g.phase = 'end'
  g.ending = { kind: 'out', p: 0 }
  R.score(g, m)
  assert.deepEqual(m.total, [101, 3])
  assert.equal(m.over, true)
})

test('your hand high to low: the most pips first, then the higher half; each shown high half first', () => {
  assert.deepEqual(R.sortedHand(ts('1-2 6-6 4-5 0-6 3-3 0-0 2-4')).map(R.tileName), ['6-6', '5-4', '6-0', '4-2', '3-3', '2-1', '0-0'])
})

test('a stacked order must be the whole set', () => {
  assert.throws(() => R.newRound(R.newMatch(), () => 0, [t('1-1')]))
  const twice = stack([]).slice()
  twice[1] = twice[0]
  assert.throws(() => R.newRound(R.newMatch(), () => 0, twice))
  assert.equal(names(stack([]).slice(0, 7)).length, 7)
})
